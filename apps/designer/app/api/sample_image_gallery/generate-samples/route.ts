import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { ImageStorage } from '@/storage/image-storage';
import { getStorageConfigFromEnv } from '@/storage/config';
import { IMAGE_STORAGE_PREFIXES } from '@/storage/prefixes';

export const dynamic = 'force-dynamic';

function createSupabaseClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // Use service role key to bypass RLS
    {
      cookies: {
        getAll() {
          return cookies().getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookies().set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { instanceId, subcategoryId, subcategoryName, accountId, count = 6 } = body;

    if (!instanceId || !subcategoryId || !subcategoryName || !accountId) {
      return NextResponse.json({ 
        error: 'Instance ID, subcategory ID, subcategory name, and account ID are required' 
      }, { status: 400 });
    }

    // Check for required environment variables
    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ 
        error: 'Replicate API token is not configured. Please set REPLICATE_API_TOKEN environment variable.' 
      }, { status: 500 });
    }

    try {
      const storageConfig = getStorageConfigFromEnv();
    } catch (storageError) {
      return NextResponse.json({ 
        error: `Storage configuration error: ${storageError instanceof Error ? storageError.message : 'Unknown error'}` 
      }, { status: 500 });
    }

    const supabase = createSupabaseClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: instance, error: instanceError } = await supabase
      .from('instances')
      .select('account_id')
      .eq('id', instanceId)
      .single();

    if (instanceError || !instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }
    const { data: accountUser, error: accountError } = await supabase
      .from('user_accounts')
      .select('*')
      .eq('account_id', instance.account_id)
      .eq('user_id', user.id)
      .single();

    if (accountError || !accountUser) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    const { data: subcategoryInfo, error: subcategoryError } = await supabase
      .from('categories_subcategories')
      .select(`
        subcategory,
        description,
        category_id
      `)
      .eq('id', subcategoryId)
      .single();

    if (subcategoryError || !subcategoryInfo) {
      return NextResponse.json({ error: 'Subcategory not found' }, { status: 404 });
    }
    const { data: categoryInfo, error: categoryError } = await supabase
      .from('categories')
      .select('name, description')
      .eq('id', subcategoryInfo.category_id)
      .single();

    if (categoryError || !categoryInfo) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }
    let prompts: string[] = [];

    try {
      const promptResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/generate-prompts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': request.headers.get('cookie') || '',
        },
        body: JSON.stringify({
          subcategoryId,
          count
        })
      });

      if (promptResponse.ok) {
        const promptData = await promptResponse.json();
        prompts = promptData.prompts;
      } else {
        // Fallback to hardcoded prompts
        prompts = generateDistinctPrompts(
          subcategoryInfo.subcategory,
          subcategoryInfo.description || '',
          categoryInfo?.name || 'General',
          categoryInfo?.description || '',
          count
        );
      }
    } catch (error) {
      // Fallback to hardcoded prompts
      prompts = generateDistinctPrompts(
        subcategoryInfo.subcategory,
        subcategoryInfo.description || '',
        categoryInfo?.name || 'General',
        categoryInfo?.description || '',
        count
      );
    }

    const categoryName = categoryInfo?.name || 'General';

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    const storageConfig = getStorageConfigFromEnv();
    const imageStorage = new ImageStorage(storageConfig);
    // Note: Removed dependency on ai_models table. We use the explicit
    // Replicate model string directly for sample generation.

    // Generate images one by one (simpler and more reliable)
    const generatedImages = [];
    const errors = [];

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];

      try {
        const output = await replicate.run(
          "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
          {
            input: {
              prompt: prompt,
              negative_prompt: "text, words, writing, letters, numbers, symbols, labels, captions, watermarks, signatures, not the model please, no text, no words, no writing, no letters, no numbers, no symbols, no labels, no captions, no watermarks, no signatures",
              width: 1024,
              height: 1024,
              num_outputs: 1,
              scheduler: "K_EULER",
              num_inference_steps: 50,
              guidance_scale: 7.5,
              seed: Math.floor(Math.random() * 1000000),
            }
          }
        );

        if (output && Array.isArray(output) && output.length > 0) {
          const replicateImageUrl = output[0] as string;
          const imageResponse = await fetch(replicateImageUrl);
          if (!imageResponse.ok) {
            throw new Error(`Failed to download image from Replicate: ${imageResponse.statusText}`);
          }

          const imageBlob = await imageResponse.blob();

          const storagePath = `${IMAGE_STORAGE_PREFIXES.sampleGallery}/${instanceId}/${Date.now()}-${i}.png`;
          const s3ImageUrl = await imageStorage.uploadImage(imageBlob, {
            path: storagePath,
            contentType: 'image/png',
            metadata: {
              generated_for: 'sample_gallery',
              subcategory: subcategoryInfo.subcategory,
              category: categoryName,
              instance_id: instanceId,
              prompt_text: prompt,
              generation_index: i,
              replicate_url: replicateImageUrl,
            }
          });

          // First, create a prompt entry
          const { data: promptEntry, error: promptError } = await supabase
            .from('prompts')
            .insert({
              prompt: prompt,
              variables: null
            })
            .select()
            .single();

          if (promptError) {
            continue; // Skip this image if we can't create the prompt
          }

          const { data: savedImage, error: saveError } = await supabase
            .from('images')
            .insert({
              user_id: user.id,
              instance_id: instanceId,
              // NOTE: In production, `images.model_id` is a UUID FK. We store the Replicate model
              // identifier in `metadata` instead to avoid UUID type errors.
              negative_prompt: "text, words, writing, letters, numbers, symbols, labels, captions, watermarks, signatures, not the model please, no text, no words, no writing, no letters, no numbers, no symbols, no labels, no captions, no watermarks, no signatures",
              image_url: s3ImageUrl,
              metadata: {
                generated_for: 'sample_gallery',
                subcategory: subcategoryInfo.subcategory,
                category: categoryName,
                instance_id: instanceId,
                prompt_text: prompt,
                generation_index: i,
                replicate_url: replicateImageUrl,
                s3_path: storagePath,
                ai_model: 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
                model_name: 'Stable Diffusion XL',
                model_provider: 'Replicate'
              },
              prompt_id: promptEntry.id, // Link to the prompt entry
              subcategory_id: subcategoryId,
              account_id: accountId,
              status: 'completed',
              replicate_prediction_id: null, // We're using replicate.run() not predictions
            })
            .select()
            .single();

          if (saveError) {
            console.error(`Error saving image ${i + 1}:`, saveError);
            errors.push(`Failed to save image ${i + 1}: ${saveError.message}`);
          } else {
            generatedImages.push(savedImage);
          }
        } else {
          console.error(`No output from Replicate for image ${i + 1}`);
          errors.push(`No output from Replicate for image ${i + 1}`);
        }
      } catch (error) {
        console.error(`Error generating image ${i + 1}:`, error);
        errors.push(`Failed to generate image ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Add a small delay between generations to avoid rate limiting
      if (i < prompts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (generatedImages.length === 0) {
      return NextResponse.json(
        {
          error: `Failed to generate placeholder images for ${subcategoryInfo.subcategory}.`,
          errors,
          generatedCount: 0,
          totalRequested: prompts.length,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      generatedCount: generatedImages.length,
      totalRequested: prompts.length,
      images: generatedImages,
      // Keep errors for debugging even if some succeed.
      errors,
      message: `Generated ${generatedImages.length} images for ${subcategoryInfo.subcategory}`,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function generateSamplePrompts(subcategoryName: string, count: number): string[] {
  const prompts = [];
  
  // Base prompts for different subcategories
  const basePrompts = {
    'Fashion': [
      'Professional fashion photography of elegant clothing',
      'Stylish outfit showcase with modern accessories',
      'High-end fashion design with sophisticated styling',
      'Contemporary fashion collection with clean background',
      'Luxury fashion items with premium presentation',
      'Trendy fashion ensemble with artistic composition'
    ],
    'Interior Design': [
      'Modern interior design with clean minimalist aesthetic',
      'Cozy living room with warm lighting and comfortable furniture',
      'Contemporary kitchen design with sleek appliances',
      'Elegant bedroom with luxurious bedding and decor',
      'Stylish home office with functional workspace',
      'Sophisticated dining room with elegant table setting'
    ],
    'Landscaping': [
      'Beautiful garden landscape with colorful flowers',
      'Modern outdoor living space with patio and greenery',
      'Professional landscaping with manicured lawns',
      'Tropical garden design with exotic plants',
      'Contemporary outdoor design with water features',
      'Elegant landscape architecture with pathways and seating'
    ],
    'Hair Salon': [
      'Professional hair salon interior with modern styling stations',
      'Stylish haircut showcase with professional lighting',
      'Elegant salon design with comfortable seating',
      'Modern hair styling with contemporary equipment',
      'Sophisticated salon atmosphere with premium decor',
      'Professional hair services with clean presentation'
    ],
    'Furniture Store': [
      'Modern furniture showroom with elegant displays',
      'Contemporary living room furniture collection',
      'Stylish bedroom furniture with premium materials',
      'Professional office furniture with ergonomic design',
      'Elegant dining furniture with sophisticated styling',
      'Contemporary furniture design with clean aesthetics'
    ]
  };

  // Get prompts for the specific subcategory or use generic ones
  const categoryPrompts = basePrompts[subcategoryName as keyof typeof basePrompts] || [
    'Professional product photography with clean background',
    'High-quality image with excellent lighting and composition',
    'Premium presentation with sophisticated styling',
    'Contemporary design with modern aesthetic',
    'Elegant showcase with professional quality',
    'Stylish presentation with clean and minimal design'
  ];

  // Select random prompts up to the requested count
  const shuffled = [...categoryPrompts].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function generateDistinctPrompts(
  subcategoryName: string, 
  subcategoryDesc: string, 
  categoryName: string, 
  categoryDesc: string, 
  count: number
): string[] {
  const prompts = [];
  
  // Create diverse prompts based on category and subcategory with negative prompts to avoid text
  const basePrompts = [
    `Professional ${subcategoryName} photography with excellent composition, clean background, no text, no words, no writing`,
    `High-quality ${subcategoryName} showcase with modern styling, minimalist design, no text overlay, no words`,
    `Elegant ${subcategoryName} presentation with sophisticated design, clean image, no text, no labels`,
    `Contemporary ${subcategoryName} display with clean aesthetic, no text, no writing, no words`,
    `Premium ${subcategoryName} collection with attention to detail, professional photography, no text`,
    `Luxury ${subcategoryName} showcase with artistic composition, clean background, no text, no words`,
    `Modern ${subcategoryName} design with professional lighting, minimalist style, no text overlay`,
    `Stylish ${subcategoryName} presentation with contemporary flair, clean image, no text, no writing`,
    `Sophisticated ${subcategoryName} display with elegant styling, no text, no words, no labels`,
    `Professional ${subcategoryName} portfolio with high-end quality, clean background, no text`
  ];

  // Add category-specific variations
  const categorySpecific = [
    `${categoryName} ${subcategoryName} with professional photography, clean image, no text, no words`,
    `${categoryName} ${subcategoryName} featuring modern design, minimalist style, no text overlay`,
    `${categoryName} ${subcategoryName} with elegant presentation, clean background, no text`,
    `${categoryName} ${subcategoryName} showcasing premium quality, no text, no writing, no words`,
    `${categoryName} ${subcategoryName} with contemporary styling, clean image, no text, no labels`
  ];

  // Combine all prompts
  const allPrompts = [...basePrompts, ...categorySpecific];
  
  // Generate the requested number of distinct prompts
  for (let i = 0; i < count; i++) {
    const basePrompt = allPrompts[i % allPrompts.length];
    const variation = Math.floor(i / allPrompts.length);
    
    if (variation === 0) {
      prompts.push(basePrompt);
    } else {
      prompts.push(`${basePrompt}, variation ${variation + 1}`);
    }
  }
  
  return prompts;
} 
