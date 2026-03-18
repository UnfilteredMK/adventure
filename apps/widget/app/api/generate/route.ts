import { NextRequest, NextResponse } from 'next/server';
import { CreditService } from '../../../lib/credit-service';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/server/logger';
import { isImageRefLike, normalizeReferenceImages, referenceImageSchemeCounts } from '@/lib/ai-form/utils/reference-images';

type UseCase = 'scene' | 'tryon' | 'try-on' | 'scene-placement' | 'drilldown';
type GenerationIntent = "initial" | "regenerate" | "small_improvement";

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

function mapUseCaseToServicePath(useCase: UseCase): string {
	if (useCase === 'tryon' || useCase === 'try-on') return '/v1/api/generate/try-on';
	if (useCase === 'scene-placement') return '/v1/api/generate/scene-placement';
	if (useCase === 'drilldown') return '/v1/api/generate/drilldown';
	return '/v1/api/generate/scene';
}

function normalizeUseCase(raw: unknown): UseCase {
	const v = String(raw || 'scene').trim().toLowerCase().replace(/_/g, '-');
	if (v === 'tryon' || v === 'try-on') return 'tryon';
	if (v === 'scene-placement') return 'scene-placement';
	if (v === 'drilldown') return 'drilldown';
	return 'scene';
}

function deriveAspectRatio(w?: number, h?: number): string | undefined {
	if (!w || !h || w <= 0 || h <= 0) return undefined;
	const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
	const g = gcd(Math.round(w), Math.round(h));
	return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

function imageRefSignatures(raw: unknown): string[] {
	const s = String(raw || "").trim();
	if (!s) return [];
	const out = new Set<string>([s]);
	if (/^https?:\/\//i.test(s)) {
		try {
			const u = new URL(s);
			out.add(`${u.origin}${u.pathname}`);
		} catch {}
	}
	return Array.from(out);
}

interface ResolvedImages {
	targetImage?: string;
	referenceImages: string[];
	hasInputImage: boolean;
}

function resolveImages(body: any, useCase: UseCase): ResolvedImages {
	const incomingRefs = normalizeReferenceImages(body.referenceImages, { allowData: true, max: 8 });

	const normalizePrimary = (raw: unknown): string | undefined => {
		if (!isImageRefLike(raw, true)) return undefined;
		return String(raw).trim();
	};

	const userImage = normalizePrimary(body.userImage);
	const sceneImage = normalizePrimary(body.sceneImage);
	const productImage = normalizePrimary(body.productImage);
	const selectedImage = normalizePrimary(body.selectedImage);

	let ordered: string[];
  let referenceOnly: string[] = [];
	switch (useCase) {
		case 'tryon':
			ordered = [userImage, productImage, ...incomingRefs].filter(Boolean) as string[];
			break;
		case 'scene-placement':
			ordered = [sceneImage, productImage, ...incomingRefs].filter(Boolean) as string[];
			break;
		case 'drilldown':
			ordered = [selectedImage, sceneImage, productImage, ...incomingRefs].filter(Boolean) as string[];
			break;
		default: {
			const primaries = [userImage, sceneImage, productImage].filter(Boolean) as string[];
			ordered = primaries.length > 0 ? [...primaries, ...incomingRefs] : [];
			referenceOnly = primaries.length === 0 ? incomingRefs : [];
			break;
		}
	}

	const allImages = Array.from(new Set(ordered));
	const targetImage = allImages.length > 0 ? allImages[0] : undefined;
	const referenceImages = targetImage ? allImages.slice(1) : Array.from(new Set(referenceOnly));
	return { targetImage, referenceImages, hasInputImage: Boolean(targetImage) };
}

interface ModelDefaults {
	modelId: string;
	guidanceScale: number;
	numInferenceSteps: number;
	promptUpsampling: boolean | undefined;
	aspectRatio: string;
	outputFormat: string | undefined;
}

function resolveGenerationIntent(body: any, hasInputImage: boolean): GenerationIntent {
	const raw = String(body?.generationIntent || body?.generationMode || "").trim().toLowerCase();
	if (raw === "initial" || raw === "new") return "initial";
	if (raw === "small_improvement" || raw === "small-improvement" || raw === "refine") return "small_improvement";
	if (raw === "regenerate" || raw === "refresh") return "regenerate";
	return hasInputImage ? "regenerate" : "initial";
}

function resolveModelDefaults(
	useCase: UseCase,
	hasInputImage: boolean,
	numImages: number,
	numOutputs: number,
	body: any,
	intent: GenerationIntent
): ModelDefaults {
	if (body.modelRecommendation && typeof body.modelRecommendation === 'object') {
		const rec = body.modelRecommendation;
		// Flux 1.1 Pro doesn't support num_outputs > 1; override to Schnell for multi-image concept gallery
		const needsMultiOutput = useCase === 'scene' && !hasInputImage && numOutputs > 1;
		const baseModelId = body.modelId || rec.modelId || 'black-forest-labs/flux-1.1-pro';
		const modelId = needsMultiOutput && baseModelId?.includes('flux-1.1-pro')
			? 'black-forest-labs/flux-schnell'
			: baseModelId;
		const guidanceScale = modelId.includes('flux-schnell') ? 3.5 : (body.guidanceScale ?? rec.guidanceScale ?? 6.0);
		const numInferenceSteps = modelId.includes('flux-schnell') ? 4 : (body.numInferenceSteps ?? rec.numInferenceSteps ?? 20);
		const outputFormat = modelId.includes('flux-schnell') ? 'webp' : (body.outputFormat || rec.outputFormat || undefined);
		return {
			modelId,
			guidanceScale,
			numInferenceSteps,
			promptUpsampling: body.promptUpsampling ?? rec.promptUpsampling ?? undefined,
			aspectRatio: body.aspectRatio || rec.aspectRatio || (hasInputImage ? 'match_input_image' : '1:1'),
			outputFormat,
		};
	}

	if (useCase === 'tryon') {
		if (intent === "small_improvement" && hasInputImage) {
			return {
				modelId: body.modelId || 'google/nano-banana',
				guidanceScale: body.guidanceScale ?? 5.5,
				numInferenceSteps: body.numInferenceSteps ?? 14,
				promptUpsampling: body.promptUpsampling ?? false,
				aspectRatio: body.aspectRatio || 'match_input_image',
				outputFormat: body.outputFormat || 'jpg',
			};
		}
		return {
			modelId: body.modelId || (numImages >= 2 ? 'google/nano-banana' : 'black-forest-labs/flux-kontext-pro'),
			guidanceScale: body.guidanceScale ?? 6.0,
			numInferenceSteps: body.numInferenceSteps ?? 18,
			promptUpsampling: body.promptUpsampling ?? (hasInputImage ? false : undefined),
			aspectRatio: body.aspectRatio || 'match_input_image',
			outputFormat: body.outputFormat || 'jpg',
		};
	}

	if (useCase === 'scene-placement') {
		if (intent === "small_improvement" && hasInputImage) {
			return {
				modelId: body.modelId || 'xai/grok-imagine-image',
				guidanceScale: body.guidanceScale ?? 5.5,
				numInferenceSteps: body.numInferenceSteps ?? 14,
				promptUpsampling: body.promptUpsampling ?? false,
				aspectRatio: body.aspectRatio || 'match_input_image',
				outputFormat: body.outputFormat || 'jpg',
			};
		}
		return {
			modelId: body.modelId || 'xai/grok-imagine-image',
			guidanceScale: body.guidanceScale ?? 6.0,
			numInferenceSteps: body.numInferenceSteps ?? 18,
			promptUpsampling: body.promptUpsampling ?? false,
			aspectRatio: body.aspectRatio || 'match_input_image',
			outputFormat: body.outputFormat || 'jpg',
		};
	}

	if (useCase === 'drilldown') {
		return {
			modelId: body.modelId || (numImages >= 2 ? 'google/nano-banana' : 'black-forest-labs/flux-kontext-pro'),
			guidanceScale: body.guidanceScale ?? 5.5,
			numInferenceSteps: body.numInferenceSteps ?? 25,
			promptUpsampling: body.promptUpsampling ?? true,
			aspectRatio: body.aspectRatio || 'match_input_image',
			outputFormat: body.outputFormat || 'png',
		};
	}

	// scene
	if (intent === "small_improvement" && hasInputImage) {
		return {
			modelId: body.modelId || 'black-forest-labs/flux-kontext-pro',
			guidanceScale: body.guidanceScale ?? 5.2,
			numInferenceSteps: body.numInferenceSteps ?? 14,
			promptUpsampling: body.promptUpsampling ?? false,
			aspectRatio: body.aspectRatio || 'match_input_image',
			outputFormat: body.outputFormat || 'png',
		};
	}
	// Flux 1.1 Pro does not support num_outputs > 1; use Schnell for multi-image concept gallery
	const sceneModelId =
		!hasInputImage && numOutputs > 1
			? 'black-forest-labs/flux-schnell'
			: hasInputImage
				? 'black-forest-labs/flux-kontext-pro'
				: 'black-forest-labs/flux-1.1-pro';
	const sceneGuidance = sceneModelId.includes('flux-schnell') ? 3.5 : (hasInputImage ? 5.5 : 6.0);
	const sceneSteps = sceneModelId.includes('flux-schnell') ? 4 : (hasInputImage ? 25 : 18);
	const sceneFormat = sceneModelId.includes('flux-schnell') ? 'webp' : 'png';
	return {
		modelId: body.modelId || sceneModelId,
		guidanceScale: body.guidanceScale ?? sceneGuidance,
		numInferenceSteps: body.numInferenceSteps ?? sceneSteps,
		promptUpsampling: body.promptUpsampling ?? (hasInputImage ? true : undefined),
		aspectRatio: body.aspectRatio || (hasInputImage ? 'match_input_image' : '1:1'),
		outputFormat: body.outputFormat || sceneFormat,
	};
}

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const useCase = normalizeUseCase(body.useCase);

		logger.info(`[GENERATE] Received ${useCase} request`, {
			instanceId: body.instanceId,
			hasPrompt: !!body.prompt,
			promptPreview: body.prompt?.substring(0, 80),
			hasSceneImage: !!body.sceneImage,
			hasProductImage: !!body.productImage,
			hasUserImage: !!body.userImage,
			referenceCount: Array.isArray(body.referenceImages) ? body.referenceImages.length : 0,
			hasModelRecommendation: !!body.modelRecommendation,
			generationIntent: body.generationIntent || body.generationMode || null,
		});

		if (!body.prompt) {
			return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
		}
		if (!body.instanceId) {
			return NextResponse.json({ error: 'Instance ID is required' }, { status: 400 });
		}

		const { targetImage, referenceImages, hasInputImage } = resolveImages(body, useCase);
		logger.info('[generate] normalized_reference_images', {
			instanceId: body.instanceId,
			useCase,
			hasInputImage,
			count: hasInputImage ? referenceImages.length + 1 : 0,
			schemes: referenceImageSchemeCounts(hasInputImage ? [String(targetImage || ''), ...referenceImages] : []),
			source: 'body + body.referenceImages',
		});
		const totalInputImages = hasInputImage ? referenceImages.length + 1 : 0;
		const generationIntent = resolveGenerationIntent(body, hasInputImage);
		const numOutputs = body.numOutputs || body.gallery_max_images || (useCase === 'drilldown' ? 1 : 4);
		const defaults = resolveModelDefaults(useCase, hasInputImage, totalInputImages, numOutputs, body, generationIntent);

		// Supabase + instance lookup
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
		const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl || !supabaseKey) {
			return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
		}
		const supabase = createClient(supabaseUrl, supabaseKey);

		const { data: instance, error: instanceError } = await supabase
			.from('instances')
			.select('account_id, credit_price')
			.eq('id', body.instanceId)
			.single();
		if (instanceError || !instance) {
			return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
		}
		const accountId = (instance as any).account_id;
		if (!accountId) {
			return NextResponse.json({ error: 'Invalid instance configuration' }, { status: 400 });
		}

		// Credit handling
		const creditService = new CreditService();
		const creditPrice = (instance as any).credit_price;
		const requiredCredits = numOutputs * creditPrice;
		const operation = `widget_image_generation_${body.instanceId}_${useCase}`;

		const creditCheck = await creditService.checkCredits(accountId, requiredCredits);
		if (!creditCheck.hasEnough) {
			const ensureForRequired = await creditService.ensureCredits(accountId, requiredCredits);
			if (!ensureForRequired.hasEnough) {
				return NextResponse.json(
					{
						error: 'Insufficient credits',
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

		const computedAspect = defaults.aspectRatio || deriveAspectRatio(body.width, body.height) || '1:1';

		const safetyTolerance =
			typeof body.safetyTolerance === 'number'
				? Math.min(body.safetyTolerance, hasInputImage ? 2 : 6)
				: undefined;

		logger.info(`[GENERATE] Calling DSPY ${defaults.modelId}`, {
			useCase,
			generationIntent,
			isEdit: hasInputImage,
			hasTargetImage: Boolean(targetImage),
			referenceCount: referenceImages.length,
			guidanceScale: defaults.guidanceScale,
			numInferenceSteps: defaults.numInferenceSteps,
		});
		const originalReferenceImage =
			typeof body.originalReferenceImage === "string" ? body.originalReferenceImage.trim() || undefined : undefined;
		const generationIndex =
			typeof body.generationIndex === "number" && Number.isFinite(body.generationIndex)
				? body.generationIndex
				: undefined;

		const upstreamPayload = {
			...body,
			instanceId: body.instanceId,
			useCase,
			modelId: defaults.modelId,
			numOutputs,
			aspectRatio: computedAspect,
			outputFormat: defaults.outputFormat,
			guidanceScale: defaults.guidanceScale,
			numInferenceSteps: defaults.numInferenceSteps,
			safetyTolerance,
			promptUpsampling: defaults.promptUpsampling,
			referenceImages: hasInputImage ? [targetImage, ...referenceImages].filter(Boolean) : referenceImages,
			userImage: body.userImage || (useCase === 'tryon' ? targetImage : undefined),
			sceneImage: body.sceneImage || ((useCase === 'scene' || useCase === 'scene-placement') ? targetImage : undefined),
			productImage: body.productImage || (useCase === 'tryon' ? referenceImages[0] : undefined),
			selectedImage: body.selectedImage || (useCase === 'drilldown' ? targetImage : undefined),
			budgetRange: body.budgetRange,
			generationIntent,
			...(originalReferenceImage ? { originalReferenceImage } : {}),
			...(generationIndex !== undefined ? { generationIndex } : {}),
		};

		const baseUrls = resolveFormServiceBaseUrls();
		if (baseUrls.length === 0) {
			return NextResponse.json({ error: "DSPY service URL is not configured" }, { status: 500 });
		}
		const servicePath = mapUseCaseToServicePath(useCase);
		let upstream: any = null;
		let lastError: any = null;
		for (const baseUrl of baseUrls) {
			const endpoint = new URL(servicePath, baseUrl).toString();
			try {
				const resp = await fetch(endpoint, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(upstreamPayload),
					cache: "no-store",
				});
				const text = await resp.text().catch(() => "");
				const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
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

		const upstreamImages = Array.isArray(upstream?.images)
			? upstream.images.filter((img: any) => typeof img === "string" && img.trim())
			: [];
		logger.info("[GENERATE] Upstream response", {
			instanceId: body.instanceId,
			useCase,
			imageCount: upstreamImages.length,
			requestedNumOutputs: numOutputs,
			modelId: upstream?.modelId || defaults.modelId,
		});
		const inputImages = hasInputImage ? [targetImage, ...referenceImages].filter(Boolean) : [];
		const inputSignatures = new Set<string>(inputImages.flatMap((img) => imageRefSignatures(img)));
		const filteredImages = upstreamImages.filter((img: string) =>
			imageRefSignatures(img).every((sig) => !inputSignatures.has(sig))
		);

		if (upstreamImages.length === 0) {
			logger.error("[GENERATE] Upstream returned no images", {
				instanceId: body.instanceId,
				useCase,
				predictionId: upstream?.predictionId || upstream?.id || null,
				hasInputImage,
			});
			return NextResponse.json(
				{ error: "Image generation returned no images", details: { predictionId: upstream?.predictionId || upstream?.id || null } },
				{ status: 502 }
			);
		}

		if (hasInputImage && filteredImages.length === 0) {
			logger.error("[GENERATE] Upstream echoed input image(s); rejecting response", {
				instanceId: body.instanceId,
				useCase,
				predictionId: upstream?.predictionId || upstream?.id || null,
				inputImageCount: inputImages.length,
				upstreamImageCount: upstreamImages.length,
			});
			return NextResponse.json(
				{
					error: "Image generation did not produce a new image",
					details: { reason: "output_matches_input", predictionId: upstream?.predictionId || upstream?.id || null },
				},
				{ status: 502 }
			);
		}

		if (hasInputImage && filteredImages.length < upstreamImages.length) {
			logger.warn("[GENERATE] Filtered echoed input image(s) from outputs", {
				instanceId: body.instanceId,
				useCase,
				filteredCount: upstreamImages.length - filteredImages.length,
				remainingCount: filteredImages.length,
			});
		}

		const creditResult = await creditService.deductCredits(accountId, requiredCredits, operation, body.instanceId);
		if (!creditResult.success) {
			return NextResponse.json(
				{ error: 'Generation succeeded but credit deduction failed. Please contact support.' },
				{ status: 500 }
			);
		}

		return NextResponse.json({
			success: true,
			images: hasInputImage ? filteredImages : upstreamImages,
			predictionId: upstream?.predictionId || upstream?.id,
			status: upstream?.status,
			provider: "replicate",
			modelId: upstream?.modelId || defaults.modelId,
			instanceId: body.instanceId,
			creditsDeducted: requiredCredits,
			newBalance: creditResult.newBalance,
			useCase,
		});
	} catch (error) {
		logger.error('[GENERATE] Unexpected error:', error);
		return NextResponse.json({ error: 'Failed to generate images' }, { status: 500 });
	}
}
