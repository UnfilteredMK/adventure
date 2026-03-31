import { buildSuggestionLabel } from '@adventure/refinement-server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function createSupabaseClient() {
  return createServerClient(
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
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const instanceId = searchParams.get('instanceId');
    
    if (!instanceId) {
      return NextResponse.json({ error: 'Instance ID is required' }, { status: 400 });
    }

    const supabase = createSupabaseClient();
    
    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get sample gallery images with their associated image data and prompts
    const { data: galleryImages, error } = await supabase
      .from('instance_sample_gallery')
      .select(`
        *,
        images (
          id,
          image_url,
          prompt_id,
          metadata,
          created_at,
          prompts (
            id,
            prompt
          )
        )
      `)
      .eq('instance_id', instanceId)
      .order('sort_order');

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch gallery images' }, { status: 500 });
    }

    return NextResponse.json({ galleryImages });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { instanceId, imageId, imageIds, sortOrder } = body;
    
    if (!instanceId) {
      return NextResponse.json({ error: 'Instance ID is required' }, { status: 400 });
    }

    // Handle both single image and multiple images
    const imagesToAdd = imageIds || (imageId ? [imageId] : []);
    
    if (imagesToAdd.length === 0) {
      return NextResponse.json({ error: 'At least one Image ID is required' }, { status: 400 });
    }

    const supabase = createSupabaseClient();
    
    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user has access to this instance
    const { data: instance, error: instanceError } = await supabase
      .from('instances')
      .select('account_id')
      .eq('id', instanceId)
      .single();

    if (instanceError || !instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    // Check if user has access to this account
    const { data: accountUser, error: accountError } = await supabase
      .from('user_accounts')
      .select('*')
      .eq('account_id', instance.account_id)
      .eq('user_id', user.id)
      .single();

    if (accountError || !accountUser) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get the current max sort order for this instance
    const { data: maxSortOrder, error: maxSortError } = await supabase
      .from('instance_sample_gallery')
      .select('sort_order')
      .eq('instance_id', instanceId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single();

    const nextSortOrder = (maxSortOrder?.sort_order || 0) + 1;

    // Get the images to add with their prompt information
    const { data: imagesToAddData, error: imagesError } = await supabase
      .from('images')
      .select(`
        id,
        image_url,
        metadata,
        prompt_id,
        subcategory_id
      `)
      .in('id', imagesToAdd);

    if (imagesError) {
      return NextResponse.json({ error: 'Failed to fetch image data' }, { status: 500 });
    }

    // Process each image and ensure it has a prompt entry
    const processedImages = [];
    
    for (const image of imagesToAddData || []) {
      let promptId = image.prompt_id;
      
      // If the image doesn't have a prompt_id but has prompt_text in metadata, create a prompt entry
      if (!promptId && image.metadata?.prompt_text) {
        const { data: newPrompt, error: promptError } = await supabase
          .from('prompts')
          .insert({
            prompt: image.metadata.prompt_text,
            subcategory_id: image.subcategory_id ?? null,
            suggestion_label: buildSuggestionLabel(
              String(image.metadata.prompt_text || ''),
              typeof image.metadata?.option_label === 'string'
                ? image.metadata.option_label
                : typeof image.metadata?.title === 'string'
                  ? image.metadata.title
                  : null
            ),
            variables: null,
          })
          .select()
          .single();

        if (promptError) {
          continue; // Skip this image if we can't create the prompt
        }

        promptId = newPrompt.id;

        // Update the image to link to the new prompt
        const { error: updateError } = await supabase
          .from('images')
          .update({ prompt_id: promptId })
          .eq('id', image.id);

        if (updateError) {}
      }

      processedImages.push({
        instance_id: instanceId,
        image_id: image.id,
        sort_order: sortOrder ? sortOrder + processedImages.length : nextSortOrder + processedImages.length,
      });
    }

    // Add the images to the gallery
    const { data: newGalleryItems, error } = await supabase
      .from('instance_sample_gallery')
      .insert(processedImages)
      .select();

    if (error) {
      return NextResponse.json({ error: 'Failed to add images to gallery' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      galleryItems: newGalleryItems,
      addedCount: newGalleryItems.length 
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { galleryId, newIndex, instanceId } = body;
    
    if (!galleryId || newIndex === undefined || !instanceId) {
      return NextResponse.json({ error: 'Gallery ID, new index, and instance ID are required' }, { status: 400 });
    }

    const supabase = createSupabaseClient();
    
    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all gallery items for this instance, ordered by sort_order
    const { data: allGalleryItems, error: fetchError } = await supabase
      .from('instance_sample_gallery')
      .select('*')
      .eq('instance_id', instanceId)
      .order('sort_order');

    if (fetchError) {
      return NextResponse.json({ error: 'Failed to fetch gallery items' }, { status: 500 });
    }

    // Find the item being moved
    const itemToMove = allGalleryItems.find(item => item.id === galleryId);
    if (!itemToMove) {
      return NextResponse.json({ error: 'Gallery item not found' }, { status: 404 });
    }

    const currentIndex = allGalleryItems.findIndex(item => item.id === galleryId);
    if (currentIndex === -1) {
      return NextResponse.json({ error: 'Current position not found' }, { status: 404 });
    }

    // Validate new index
    if (newIndex < 0 || newIndex >= allGalleryItems.length) {
      return NextResponse.json({ error: 'Invalid new index' }, { status: 400 });
    }

    // If moving to the same position, no need to do anything
    if (currentIndex === newIndex) {
      return NextResponse.json({ success: true, message: 'No change needed' });
    }

    // Remove the item from its current position
    const itemsWithoutMoved = allGalleryItems.filter(item => item.id !== galleryId);
    
    // Insert the item at the new position
    const newOrderedItems = [
      ...itemsWithoutMoved.slice(0, newIndex),
      itemToMove,
      ...itemsWithoutMoved.slice(newIndex)
    ];

    // Calculate new sort orders (using increments of 1 for clean ordering)
    const updatedItems = newOrderedItems.map((item, index) => ({
      ...item,
      sort_order: index + 1
    }));

    // Update all items in a transaction
    const { error: updateError } = await supabase
      .from('instance_sample_gallery')
      .upsert(updatedItems, { onConflict: 'id' });

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update gallery items' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Gallery items reordered successfully',
      updatedItems 
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const galleryId = searchParams.get('id');
    
    if (!galleryId) {
      return NextResponse.json({ error: 'Gallery ID is required' }, { status: 400 });
    }

    const supabase = createSupabaseClient();
    
    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Delete gallery image
    const { error } = await supabase
      .from('instance_sample_gallery')
      .delete()
      .eq('id', galleryId);

    if (error) {
      return NextResponse.json({ error: 'Failed to delete gallery image' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 