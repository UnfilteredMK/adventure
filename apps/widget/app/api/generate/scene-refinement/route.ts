"use server";

import { NextRequest, NextResponse } from "next/server";
import { CreditService } from "../../../../lib/credit-service";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/server/logger";

function normalizeServiceUrl(raw: unknown): string {
	let s = String(raw || "").trim();
	if (!s) return "";
	if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
	return s.replace(/\/+$/, "");
}

function resolveFormServiceBaseUrls(): string[] {
	const isDevMode = process.env.NEXT_PUBLIC_AI_FORM_DEV_MODE === "true" || process.env.NODE_ENV !== "production";
	const devUrl = normalizeServiceUrl(process.env.DEV_DSPY_SERVICE_URL || "");
	const prodUrl = normalizeServiceUrl(process.env.PROD_DSPY_SERVICE_URL || process.env.DSPY_SERVICE_URL || "");
	const urls: string[] = [];
	if (isDevMode) {
		if (devUrl) urls.push(devUrl);
		if (prodUrl) urls.push(prodUrl);
	} else {
		if (prodUrl) urls.push(prodUrl);
		if (devUrl) urls.push(devUrl);
	}
	return Array.from(new Set(urls)).filter(Boolean);
}

// Scene refinement (ideas / prompt-based edit on the current preview anchor)
// Proxies to api-service /v1/api/generate/scene-refinement
export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const generationIntent = String(body?.generationIntent || "").trim().toLowerCase();

		if (!body.instanceId) {
			return NextResponse.json({ error: "Instance ID is required" }, { status: 400 });
		}
		if (!body.sceneImage) {
			return NextResponse.json({ error: "sceneImage is required" }, { status: 400 });
		}

		const modelId = body.modelId || "xai/grok-imagine-image";
		const numOutputs =
			generationIntent === "small_improvement" || generationIntent === "small-improvement"
				? 1
				: body.numOutputs || body.gallery_max_images || 1;

		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
		const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl || !supabaseKey) {
			return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
		}
		const supabase = createClient(supabaseUrl, supabaseKey);

		const { data: instance, error: instanceError } = await supabase
			.from("instances")
			.select("account_id, credit_price")
			.eq("id", body.instanceId)
			.single();
		if (instanceError || !instance) {
			return NextResponse.json({ error: "Instance not found" }, { status: 404 });
		}
		const accountId = (instance as any).account_id;
		if (!accountId) {
			return NextResponse.json({ error: "Invalid instance configuration" }, { status: 400 });
		}

		const creditService = new CreditService();
		const creditPrice = (instance as any).credit_price;
		const requiredCredits = numOutputs * creditPrice;
		const operation = `widget_image_generation_${body.instanceId}_scene_refinement`;

		const creditCheck = await creditService.checkCredits(accountId, requiredCredits);
		if (!creditCheck.hasEnough) {
			const ensureForRequired = await creditService.ensureCredits(accountId, requiredCredits);
			if (!ensureForRequired.hasEnough) {
				return NextResponse.json(
					{
						error: "Insufficient credits",
						currentBalance: ensureForRequired.currentBalance,
						requiredCredits,
						shortfall: ensureForRequired.shortfall,
						autoTopUpAttempted: ensureForRequired.toppedUp,
						autoTopUpAmount: ensureForRequired.topUpAmount,
					},
					{ status: 402 }
				);
			}
		} else {
			const predictedPost = (creditCheck.currentBalance || 0) - requiredCredits;
			if (predictedPost <= 0) {
				try {
					await creditService.ensureCredits(accountId, requiredCredits + 1);
				} catch {}
			}
		}

		const extraRefs: string[] = Array.isArray(body.referenceImages) ? body.referenceImages : [];
		const ordered = [body.sceneImage, body.productImage, ...extraRefs].filter(Boolean);
		const allImages = Array.from(new Set(ordered));
		const targetImage = allImages[0];
		const referenceImages = allImages.slice(1);
		const hasInputImage = allImages.length > 0;

		const guidanceScale = body.guidanceScale ?? 6.0;
		const numInferenceSteps = body.numInferenceSteps ?? 18;
		const promptUpsampling = body.promptUpsampling ?? (hasInputImage ? false : undefined);
		const safetyTolerance =
			typeof body.safetyTolerance === "number"
				? Math.min(body.safetyTolerance, hasInputImage ? 2 : 6)
				: undefined;

		const deriveAspectRatio = (w?: number, h?: number): string | undefined => {
			if (!w || !h || w <= 0 || h <= 0) return undefined;
			const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
			const g = gcd(Math.round(w), Math.round(h));
			const aw = Math.round(w / g);
			const ah = Math.round(h / g);
			return `${aw}:${ah}`;
		};
		const computedAspect = body.aspectRatio || deriveAspectRatio(body.width, body.height);

		const baseUrls = resolveFormServiceBaseUrls();
		if (baseUrls.length === 0) {
			return NextResponse.json({ error: "DSPY service URL is not configured" }, { status: 500 });
		}

		const upstreamPayload = {
			...body,
			instanceId: body.instanceId,
			useCase: "scene-refinement",
			modelId,
			numOutputs,
			aspectRatio: computedAspect || "match_input_image",
			guidanceScale,
			numInferenceSteps,
			safetyTolerance,
			promptUpsampling,
			referenceImages: [targetImage, ...referenceImages].filter(Boolean),
			sceneImage: body.sceneImage || targetImage,
			productImage: body.productImage || undefined,
		};

		let upstream: any = null;
		let lastError: any = null;
		for (const baseUrl of baseUrls) {
			const endpoint = new URL("/v1/api/generate/scene-refinement", baseUrl).toString();
			try {
				const resp = await fetch(endpoint, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(upstreamPayload),
					cache: "no-store",
				});
				const text = await resp.text().catch(() => "");
				const json = text
					? (() => {
							try {
								return JSON.parse(text);
							} catch {
								return null;
							}
						})()
					: null;
				if (!resp.ok) {
					lastError = { status: resp.status, details: json ?? text.slice(0, 2000) };
					continue;
				}
				upstream = json;
				break;
			} catch (e) {
				lastError = e instanceof Error ? e.message : String(e);
			}
		}
		if (!upstream || upstream.ok === false) {
			return NextResponse.json({ error: "Image generation failed", details: lastError || upstream }, { status: 502 });
		}

		const creditResult = await creditService.deductCredits(accountId, requiredCredits, operation, body.instanceId);
		if (!creditResult.success) {
			return NextResponse.json(
				{ error: "Generation succeeded but credit deduction failed. Please contact support." },
				{ status: 500 }
			);
		}

		return NextResponse.json({
			success: true,
			images: Array.isArray(upstream?.images) ? upstream.images : [],
			predictionId: upstream?.predictionId || upstream?.id,
			status: upstream?.status,
			provider: upstream?.provider || "replicate",
			modelId: upstream?.modelId || modelId,
			instanceId: body.instanceId,
			creditsDeducted: requiredCredits,
			newBalance: creditResult.newBalance,
			useCase: "scene-refinement",
		});
	} catch (error) {
		logger.error("💥 [SCENE-REFINEMENT API] Unexpected error:", error);
		return NextResponse.json({ error: "Failed to generate scene refinement" }, { status: 500 });
	}
}
