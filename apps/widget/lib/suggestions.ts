import { Suggestion } from '../types';
import { createClient } from '../supabase/client';

export type { Suggestion };

// Art styles for variety
const artStyles = ["anime", "art nouveau", "ukiyo-e", "watercolor", "photorealistic", "digital art", "oil painting", "sketch"];

function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get suggestions from the database based on instance subcategories
 * Only returns prompts that are actually stored in the prompts table
 */
export const getSuggestions = async (
  instanceId: string, 
  count: number = 3
): Promise<Suggestion[]> => {
  try {
    if (!instanceId) {
      console.warn('No instanceId provided for suggestions');
      return [];
    }

    const supabase = createClient();

    // Get subcategories for this instance
    const { data: instanceSubcategories, error: subError } = await supabase
      .from('instance_subcategories')
      .select(`
        category_subcategory_id,
        categories_subcategories (
          id,
          subcategory,
          categories ( name )
        )
      `)
      .eq('instance_id', instanceId);

    if (subError) {
      console.error('Error fetching instance subcategories:', subError);
      return [];
    }

    if (!instanceSubcategories || instanceSubcategories.length === 0) {
      console.log('No subcategories found for instance:', instanceId);
      return [];
    }

    // Get subcategory IDs
    const subcategoryIds = instanceSubcategories.map(
      (item: any) => item.categories_subcategories.id
    );

    // Get images that have both prompt_id and subcategory_id
    const { data: images, error: imageError } = await supabase
      .from('images')
      .select(`
        id,
        prompt_id,
        subcategory_id,
        categories_subcategories (
          subcategory,
          categories ( name )
        )
      `)
      .in('subcategory_id', subcategoryIds)
      .not('prompt_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100); // Get more than needed to have variety

    if (imageError) {
      console.error('Error fetching images with prompts:', imageError);
      return [];
    }

    if (!images || images.length === 0) {
      console.log('No images with prompts found for subcategories');
      return [];
    }

    // Get unique prompt IDs
    const promptIds = [...new Set(images.map((img: any) => img.prompt_id).filter(Boolean))];

    if (promptIds.length === 0) {
      console.log('No valid prompt IDs found');
      return [];
    }

    // Fetch the actual prompts from the prompts table
    const { data: prompts, error: promptError } = await supabase
      .from('prompts')
      .select('id, prompt, variables')
      .in('id', promptIds);

    if (promptError) {
      console.error('Error fetching prompts:', promptError);
      return [];
    }

    if (!prompts || prompts.length === 0) {
      console.log('No prompts found in prompts table');
      return [];
    }

    // Supabase typing can widen to `never[]` without generated table types.
    // Normalize to a concrete shape before building the map.
    const promptRows = (prompts || []) as Array<{
      id: string;
      prompt: string;
      variables?: any;
    }>;
    const promptMap = new Map(promptRows.map((p) => [p.id, p]));

    // Create suggestions by combining image data with prompt data
    const suggestions: Array<{
      prompt: string;
      category: string;
      subcategory: string;
      variables?: any;
    }> = [];

    images.forEach((image: any) => {
      const promptData = promptMap.get(image.prompt_id);
      if (promptData && image.categories_subcategories) {
        const category = (image.categories_subcategories.categories?.name as string) || 'Unknown';
        const subcategory = image.categories_subcategories.subcategory || 'Unknown';
        
        // Check if we already have this exact prompt for this category/subcategory
        const existingIndex = suggestions.findIndex(s => 
          s.prompt === promptData.prompt && 
          s.category === category && 
          s.subcategory === subcategory
        );
        
        if (existingIndex === -1) {
          suggestions.push({
            prompt: promptData.prompt,
            category,
            subcategory,
            variables: promptData.variables
          });
        }
      }
    });

    if (suggestions.length === 0) {
      console.log('No valid suggestions created from prompts');
      return [];
    }

    // Shuffle and select suggestions
    const shuffledSuggestions = shuffle(suggestions);
    const shuffledStyles = shuffle(artStyles);
    
    const selectedSuggestions = shuffledSuggestions.slice(0, count);
    
    return selectedSuggestions.map((item, index) => {
      const fullPrompt = `${item.prompt}, in the style of ${
        shuffledStyles[index % shuffledStyles.length]
      }`;
      
      // Create a truncated version for display (first 50 characters)
      const truncatedText = item.prompt.length > 50 
        ? `${item.prompt.substring(0, 50)}...` 
        : item.prompt;
      
      return {
        text: truncatedText,
        prompt: fullPrompt,
        category: item.category,
        subcategory: item.subcategory,
        style: shuffledStyles[index % shuffledStyles.length]
      };
    });

  } catch (error) {
    console.error('Error getting suggestions from database:', error);
    return [];
  }
};

/**
 * Legacy function for backward compatibility - now just calls getSuggestions
 * @deprecated Use getSuggestions instead
 */
export const getDynamicSuggestions = async (
  instanceId: string, 
  count: number = 3,
  supabase?: any // Keep for backward compatibility but not used
): Promise<Suggestion[]> => {
  return getSuggestions(instanceId, count);
};

/**
 * Legacy function for backward compatibility - now returns empty array
 * @deprecated Use getSuggestions instead
 */
export const getRandomSuggestions = (count: number = 3): Suggestion[] => {
  console.warn('getRandomSuggestions is deprecated. Use getSuggestions instead.');
  return [];
};
