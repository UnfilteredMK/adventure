import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import Replicate from 'replicate';
import { ImageStorage } from '@/storage/image-storage';
import { StorageConfig } from '@/storage/types';
import { IMAGE_STORAGE_PREFIXES } from '@/storage/prefixes';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id: predictionId, status, output, error } = body;

    if (!predictionId) {
      return NextResponse.json({ error: 'Missing prediction ID' }, { status: 400 });
    }

    // Initialize Supabase client
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

    // Find the pending image record
    const { data: pendingImage, error: findError } = await supabase
      .from('images')
      .select('*')
      .eq('replicate_prediction_id', predictionId)
      .single();

    if (findError || !pendingImage) {
      return NextResponse.json({ error: 'Pending image not found' }, { status: 404 });
    }

    if (status === 'succeeded' && output) {
      // Generation succeeded, download and upload to S3
      const imageUrl = Array.isArray(output) ? output[0] : output;
      
      try {
        // Download the image from Replicate
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to download image: ${response.statusText}`);
        }

        const imageBlob = await response.blob();

        // Initialize S3 storage
        const storageConfig: StorageConfig = {
          s3Config: {
            endpoint: process.env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/s3',
            region: 'us-east-1',
            credentials: {
              accessKeyId: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              secretAccessKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            },
            forcePathStyle: true,
          },
          supabaseClient: supabase,
        };

        const imageStorage = new ImageStorage(storageConfig);

        // Upload to S3
        const s3ImageUrl = await imageStorage.uploadImage(imageBlob, {
          path: `${IMAGE_STORAGE_PREFIXES.subcategory}/generated/${pendingImage.id}.png`,
          bucket: 'images',
        });

        // Update the image record with S3 URL
        const { error: updateError } = await supabase
          .from('images')
          .update({
            image_url: s3ImageUrl,
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', pendingImage.id);

        if (updateError) {
          return NextResponse.json({ error: 'Failed to update image' }, { status: 500 });
        }
      } catch (uploadError) {
        // Fallback: store the Replicate URL directly if S3 upload fails
        const { error: updateError } = await supabase
          .from('images')
          .update({
            image_url: imageUrl,
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', pendingImage.id);

        if (updateError) {}
      }
    } else if (status === 'failed' || error) {
      // Generation failed, update the status
      const { error: updateError } = await supabase
        .from('images')
        .update({
          status: 'failed',
          metadata: {
            ...pendingImage.metadata,
            error: error || 'Generation failed',
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', pendingImage.id);

      if (updateError) {}
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 
