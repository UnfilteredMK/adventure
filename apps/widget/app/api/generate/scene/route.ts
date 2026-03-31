import { NextRequest, NextResponse } from 'next/server';
import { CreditService } from '../../../../lib/credit-service';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/server/logger';
import { isImageRefLike, normalizeReferenceImages, referenceImageSchemeCounts } from '@/lib/ai-form/utils/reference-images';
import { mergeInstanceContextFromDb } from '@/lib/server/merge-instance-context-from-db';

type ReferenceMode = "guide_only" | "edit_target";

function normalizeRequestedOutputs(raw: unknown): number {
	const n = Number(raw);
	if (!Number.isFinite(n)) return 1;
	return Math.max(1, Math.min(9, Math.floor(n)));
}

function supportsMultiOutput(modelId: string): boolean {
	const model = String(modelId || '').trim().toLowerCase();
	if (!model) return true;
	if (model.includes('flux-kontext')) return false;
	if (model.includes('nano-banana')) return false;
	if (model.includes('grok-imagine-image')) return false;
	if (model.includes('flux-1.1-pro')) return false;
	return true;
}

function resolveEffectiveNumOutputs(requested: number, modelId: string): number {
	const normalizedRequested = normalizeRequestedOutputs(requested);
	if (normalizedRequested <= 1) return 1;
	return supportsMultiOutput(modelId) ? normalizedRequested : 1;
}

function normalizeReferenceMode(raw: unknown): ReferenceMode | undefined {
	const v = String(raw || "").trim().toLowerCase();
	if (v === "guide_only") return "guide_only";
	if (v === "edit_target") return "edit_target";
	return undefined;
}

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

function previewText(value: unknown, limit = 220): string | null {
	const text = String(value || "").trim();
	if (!text) return null;
	return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function summarizeImageList(images: string[]): { count: number; schemes: Record<string, number> } {
	return {
		count: images.length,
		schemes: referenceImageSchemeCounts(images),
	};
}

function objectOrEmpty(raw: unknown): Record<string, any> {
	if (!raw || typeof raw !== "object") return {};
	if (Array.isArray(raw)) return {};
	return raw as Record<string, any>;
}

// Scene generation / editing
// - If an input image is provided: do Flux Kontext scene EDITING (single input image)
// - If no input image is provided: do text-to-image to generate an initial scene (no uploads required)
export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const generationIntent = String(body?.generationIntent || "").trim().toLowerCase();

		// Log incoming request for debugging
		logger.info('📥 [SCENE API] Received request:', {
			hasPrompt: !!body.prompt,
			promptPreview: body.prompt?.substring(0, 50),
			instanceId: body.instanceId,
			isDrillDown: body.isDrillDown,
			hasReferenceImages: Array.isArray(body.referenceImages),
			referenceImagesCount: Array.isArray(body.referenceImages) ? body.referenceImages.length : 0,
			hasSceneImage: !!body.sceneImage,
			hasProductImage: !!body.productImage,
			hasUserImage: !!body.userImage,
			requestKeys: Object.keys(body),
			bodySummary: {
				prompt: body.prompt?.substring(0, 100),
				instanceId: body.instanceId,
				referenceImages: body.referenceImages ? `[${body.referenceImages.length} items]` : 'missing',
				sceneImage: body.sceneImage ? '[present]' : 'missing',
				productImage: body.productImage ? '[present]' : 'missing',
				userImage: body.userImage ? '[present]' : 'missing',
				isDrillDown: body.isDrillDown
			}
		});

		if (!body.instanceId) {
			logger.error('❌ [SCENE API] Missing instanceId');
			return NextResponse.json({ error: 'Instance ID is required' }, { status: 400 });
		}

		// If this is a drilldown request (has isDrillDown flag), reject with helpful error
		// Drilldown is only for DrillDownModal when clicking on generated images
		if (body.isDrillDown) {
			logger.error('🚨 [SCENE API] Drilldown request incorrectly routed to scene endpoint:', {
				isDrillDown: body.isDrillDown,
				hasReferenceImages: Array.isArray(body.referenceImages) && body.referenceImages.length > 0,
				referenceImagesCount: Array.isArray(body.referenceImages) ? body.referenceImages.length : 0,
				hasSceneImage: !!body.sceneImage,
				hasProductImage: !!body.productImage,
				prompt: body.prompt?.substring(0, 50)
			});
			return NextResponse.json(
				{
					error: 'Drilldown requests should use /api/generate/drilldown endpoint, not /api/generate/scene'
				},
				{ status: 400 }
			);
		}

		// Determine whether this scene request is a guide-only concept generation run
		// or a true edit anchored to an uploaded image.
		const incomingRefs = normalizeReferenceImages(body.referenceImages, { allowData: true, max: 8 });
		const normalizePrimary = (raw: unknown): string | null => {
			if (!isImageRefLike(raw, true)) return null;
			const value = String(raw).trim();
			return value || null;
		};
		const userImage = normalizePrimary(body.userImage);
		const sceneImage = normalizePrimary(body.sceneImage);
		const productImage = normalizePrimary(body.productImage);
		const referenceMode = normalizeReferenceMode(body.referenceMode);
		const guideOnlyInitialScene =
			referenceMode === "guide_only" && generationIntent === "initial";
		const primaryCandidates = [userImage, sceneImage, productImage].filter(Boolean) as string[];
		// guide_only only means "style refs are not the anchor"; explicit uploads are still edit targets.
		const primaryImage =
			guideOnlyInitialScene && primaryCandidates.length === 0
				? null
				: primaryCandidates[0] ?? null;
		const referenceImages = primaryImage
			? Array.from(new Set([...primaryCandidates.slice(1), ...incomingRefs]))
			: Array.from(new Set(incomingRefs));
		const allImages = [primaryImage, ...referenceImages].filter(Boolean) as string[];
		const isEdit = Boolean(primaryImage);

		logger.info('[SCENE API] resolved image inputs', {
			instanceId: body.instanceId,
			generationIntent,
			referenceMode: referenceMode || null,
			guideOnlyInitialScene,
			isEdit,
			primaryCandidates: {
				hasUserImage: Boolean(userImage),
				hasSceneImage: Boolean(sceneImage),
				hasProductImage: Boolean(productImage),
				incomingReferenceImagesCount: incomingRefs.length,
			},
			selectedPrimarySource: primaryImage === userImage
				? 'userImage'
				: primaryImage === sceneImage
					? 'sceneImage'
					: primaryImage === productImage
						? 'productImage'
						: primaryImage
							? 'referenceImages'
							: null,
			selectedPrimaryPreview: previewText(primaryImage, 120),
			referenceImages: summarizeImageList(referenceImages),
			allImages: summarizeImageList(allImages),
		});

		if (isEdit && allImages.length > 1) {
			logger.warn(
				'⚠️ [SCENE API] Multiple input images provided; selecting the first to maximize adherence:',
				{
					imageCount: allImages.length,
					selectedImageSource: userImage
						? 'userImage'
						: sceneImage
							? 'sceneImage'
							: productImage
								? 'productImage'
								: 'referenceImages'
				}
			);
		}

		// Default model:
		// - editing: FLUX Kontext Pro (single-image edit)
		// - initial multi-output concept gallery: FLUX Schnell
		// - initial single-output: FLUX 1.1 Pro
		const requestedNumOutputs = normalizeRequestedOutputs(body.numOutputs || body.gallery_max_images || 4);
		const modelId =
			body.modelId ||
			(generationIntent === "small_improvement" || generationIntent === "small-improvement"
				? (isEdit ? 'black-forest-labs/flux-kontext-pro' : 'black-forest-labs/flux-1.1-pro')
				: isEdit
					? 'black-forest-labs/flux-kontext-pro'
					: requestedNumOutputs > 1
						? 'black-forest-labs/flux-schnell'
						: 'black-forest-labs/flux-1.1-pro');

		// Number of outputs
		const numOutputs =
			generationIntent === "small_improvement" || generationIntent === "small-improvement"
				? 1
				: resolveEffectiveNumOutputs(requestedNumOutputs, modelId);

		// Supabase setup
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
		const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl || !supabaseKey) {
			return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
		}
		const supabase = createClient(supabaseUrl, supabaseKey);

		// Load full instance row (same as pricing). Avoid selecting ad-hoc columns that may not exist on older DBs.
		const { data: instance, error: instanceError } = await supabase
			.from('instances')
			.select('*')
			.eq('id', body.instanceId)
			.single();
		if (instanceError || !instance) {
			logger.error('[SCENE API] instance lookup failed', {
				instanceId: body.instanceId,
				code: (instanceError as any)?.code,
				message: instanceError?.message,
			});
			return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
		}

		const mergedInstanceContext = await mergeInstanceContextFromDb({
			supabase,
			instance: instance as Record<string, any>,
			stepDataSoFar: objectOrEmpty(body.stepDataSoFar),
			instanceContext: objectOrEmpty(body.instanceContext),
		});

		const accountId = (instance as any).account_id;
		if (!accountId) {
			return NextResponse.json({ error: 'Invalid instance configuration' }, { status: 400 });
		}

		// Credits
		const creditService = new CreditService();
		const creditPrice = (instance as any).credit_price;
		const requiredCredits = numOutputs * creditPrice;
		const operation = `widget_image_generation_${body.instanceId}_scene`;

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
						autoTopUpAmount: ensureForRequired.topUpAmount
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

		const guidanceScale = body.guidanceScale ?? (modelId.includes('flux-schnell') ? 4.25 : isEdit ? 5.5 : 6.0);
		const numInferenceSteps = body.numInferenceSteps ?? (modelId.includes('flux-schnell') ? 6 : isEdit ? 25 : 18);
		const promptUpsampling = body.promptUpsampling ?? (modelId.includes('flux-schnell') ? undefined : isEdit ? true : undefined);
		const safetyTolerance =
			typeof body.safetyTolerance === 'number'
				? Math.min(body.safetyTolerance, isEdit ? 2 : 6)
				: undefined;

		// Derive aspect ratio from provided width/height if not explicitly set
		const deriveAspectRatio = (w?: number, h?: number): string | undefined => {
			if (!w || !h || w <= 0 || h <= 0) return undefined;
			const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
			const g = gcd(Math.round(w), Math.round(h));
			const aw = Math.round(w / g);
			const ah = Math.round(h / g);
			return `${aw}:${ah}`;
		};
		const computedAspect = body.aspectRatio || deriveAspectRatio(body.width, body.height);

		const upstreamPayload = {
			...body,
			instanceId: body.instanceId,
			instanceContext: mergedInstanceContext,
			modelId,
			numOutputs,
			aspectRatio: computedAspect || (isEdit ? 'match_input_image' : '1:1'),
			guidanceScale,
			numInferenceSteps,
			safetyTolerance,
			promptUpsampling,
			referenceImages: [primaryImage, ...referenceImages].filter(Boolean),
		};

		logger.info('[SCENE API] upstream payload summary', {
			instanceId: body.instanceId,
			useCase: 'scene',
			modelId,
			numOutputs,
			guidanceScale,
			numInferenceSteps,
			promptUpsampling: promptUpsampling ?? null,
			safetyTolerance: safetyTolerance ?? null,
			aspectRatio: upstreamPayload.aspectRatio,
			generationIntent,
			hasPrompt: Boolean(body.prompt),
			promptPreview: previewText(body.prompt, 180),
			answeredQACount: Array.isArray(body.answeredQA) ? body.answeredQA.length : 0,
			stepDataKeys: body.stepDataSoFar && typeof body.stepDataSoFar === 'object'
				? Object.keys(body.stepDataSoFar).slice(0, 20)
				: [],
			referenceImages: summarizeImageList((upstreamPayload.referenceImages || []).filter((img: unknown): img is string => typeof img === 'string' && !!img.trim())),
		});

			let upstream: any = null;
			let lastError: any = null;
			const baseUrls = resolveFormServiceBaseUrls();
			if (baseUrls.length === 0) {
				return NextResponse.json({ error: "DSPY service URL is not configured" }, { status: 500 });
			}
			for (const baseUrl of baseUrls) {
				const endpoint = new URL("/v1/api/generate/scene", baseUrl).toString();
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
						logger.warn('[SCENE API] upstream request failed', {
							instanceId: body.instanceId,
							endpoint,
							status: resp.status,
							errorPreview: previewText(JSON.stringify(lastError), 280),
						});
						continue;
					}
					upstream = json;
					logger.info('[SCENE API] upstream response summary', {
						instanceId: body.instanceId,
						endpoint,
						ok: upstream?.ok !== false,
						status: upstream?.status || null,
						predictionId: upstream?.predictionId || upstream?.id || null,
						modelId: upstream?.modelId || modelId,
						outputCount: Array.isArray(upstream?.images)
							? upstream.images.length
							: Array.isArray(upstream?.output)
								? upstream.output.length
								: upstream?.output
									? 1
									: 0,
						error: upstream?.error || null,
						message: previewText(upstream?.message, 220),
					});
					break;
				} catch (e) {
					lastError = e instanceof Error ? e.message : String(e);
					logger.warn('[SCENE API] upstream fetch exception', {
						instanceId: body.instanceId,
						endpoint,
						error: previewText(lastError, 280),
					});
				}
			}

		if (!upstream || upstream.ok === false) {
			return NextResponse.json({ error: "Image generation failed", details: lastError || upstream }, { status: 502 });
		}

		const upstreamImages = Array.isArray(upstream?.images)
			? upstream.images.filter((img: any) => typeof img === "string" && img.trim())
			: [];
		const inputImages = [primaryImage, ...(referenceImages || [])].filter(Boolean);
		const inputSignatures = new Set<string>(inputImages.flatMap((img) => imageRefSignatures(img)));
		const filteredImages = upstreamImages.filter((img: string) =>
			imageRefSignatures(img).every((sig) => !inputSignatures.has(sig))
		);

		logger.info('[SCENE API] output filtering summary', {
			instanceId: body.instanceId,
			isEdit,
			upstreamImagesCount: upstreamImages.length,
			filteredImagesCount: filteredImages.length,
			inputImagesCount: inputImages.length,
			inputSignaturesCount: inputSignatures.size,
		});

		if (upstreamImages.length === 0) {
			return NextResponse.json(
				{ error: "Image generation returned no images", details: { predictionId: upstream?.predictionId || upstream?.id || null } },
				{ status: 502 }
			);
		}
		if (isEdit && filteredImages.length === 0) {
			return NextResponse.json(
				{
					error: "Image generation did not produce a new image",
					details: { reason: "output_matches_input", predictionId: upstream?.predictionId || upstream?.id || null },
				},
				{ status: 502 }
			);
		}

		// Deduct credits
		const creditResult = await creditService.deductCredits(accountId, requiredCredits, operation, body.instanceId);
		if (!creditResult.success) {
		 return NextResponse.json(
				{ error: 'Generation succeeded but credit deduction failed. Please contact support.' },
				{ status: 500 }
			);
		}

		return NextResponse.json({
			success: true,
			images: isEdit ? filteredImages : upstreamImages,
			predictionId: upstream?.predictionId || upstream?.id,
			status: upstream?.status,
			provider: upstream?.provider || upstream?.attempts?.find((attempt: any) => attempt?.ok)?.providerId || "replicate",
			modelId: upstream?.modelId || modelId,
			instanceId: body.instanceId,
			creditsDeducted: requiredCredits,
			newBalance: creditResult.newBalance,
			useCase: 'scene'
		});
	} catch (error) {
		logger.error('💥 [SCENE API] Unexpected error:', error);
		return NextResponse.json({ error: 'Failed to generate scene placement images' }, { status: 500 });
	}
}
