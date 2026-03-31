const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables:');
  console.error('- NEXT_PUBLIC_SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/** Match shared `buildSuggestionLabel`: short chip text from full prompt. */
function buildSuggestionLabel(fullPrompt, preferredShort, maxLen = 50) {
  const pref = String(preferredShort || '').trim();
  if (pref) {
    return pref.length <= maxLen ? pref : `${pref.slice(0, Math.max(0, maxLen - 1))}…`;
  }
  const p = String(fullPrompt || '').trim();
  if (!p) return '';
  return p.length <= maxLen ? p : `${p.slice(0, Math.max(0, maxLen - 1))}…`;
}

// Sample images mapping
const sampleImages = {
  'bathroom': [
    { file: 'bathroom1.png', prompt: 'Modern bathroom with clean lines and contemporary fixtures' },
    { file: 'bathroom2.png', prompt: 'Luxury bathroom with marble surfaces and elegant design' },
    { file: 'bathroom3.png', prompt: 'Small bathroom with space-saving solutions and modern style' }
  ],
  'fashion': [
    { file: 'fashion1.png', prompt: 'Elegant evening dress with sophisticated styling' },
    { file: 'fashion2.png', prompt: 'Casual summer outfit with comfortable and stylish design' },
    { file: 'fashion3.png', prompt: 'Business professional attire with modern tailoring' }
  ],
  'furniture': [
    { file: 'furniture1.png', prompt: 'Modern sectional sofa with clean lines and neutral colors' },
    { file: 'furniture2.png', prompt: 'Rustic dining table with reclaimed wood and metal legs' },
    { file: 'furniture3.png', prompt: 'Contemporary bedroom set with minimalist design' }
  ],
  'interior': [
    { file: 'interior1.png', prompt: 'Modern living room with neutral colors and contemporary furniture' },
    { file: 'interior2.png', prompt: 'Cozy kitchen with white cabinets and wooden accents' },
    { file: 'interior3.png', prompt: 'Luxury bedroom with elegant lighting and sophisticated design' }
  ],
  'landscaping': [
    { file: 'landscaping1.png', prompt: 'Front yard landscaping with native plants and stone pathways' },
    { file: 'landscaping2.png', prompt: 'Backyard patio with outdoor kitchen and dining area' },
    { file: 'landscaping3.png', prompt: 'Garden with raised beds and vegetable planting areas' }
  ]
};

// Subcategory mapping
const subcategoryMapping = {
  'bathroom': 'sub-bathroom',
  'fashion': 'sub-clothing',
  'furniture': 'sub-furniture',
  'interior': 'sub-interior-design',
  'landscaping': 'sub-landscaping'
};

async function seedSampleImages() {
  console.log('🌱 Starting sample images seeding...');

  try {
    // First, let's check if we have any existing sample images
    const { data: existingImages, error: checkError } = await supabase
      .from('images')
      .select('id')
      .eq('account_id', null)
      .limit(1);

    if (checkError) {
      console.error('Error checking existing images:', checkError);
      return;
    }

    if (existingImages && existingImages.length > 0) {
      console.log('✅ Sample images already exist in database');
      return;
    }

    // Create sample images for each category
    for (const [category, images] of Object.entries(sampleImages)) {
      const subcategoryId = subcategoryMapping[category];
      
      if (!subcategoryId) {
        console.log(`⚠️  No subcategory mapping found for ${category}, skipping...`);
        continue;
      }

      console.log(`📸 Processing ${category} images...`);

      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const imagePath = `/services/${category}/${image.file}`;
        
        // Create a prompt entry first
        const { data: promptData, error: promptError } = await supabase
          .from('prompts')
          .insert({
            prompt: image.prompt,
            subcategory_id: subcategoryId,
            variables: null,
            suggestion_label: buildSuggestionLabel(image.prompt),
          })
          .select()
          .single();

        if (promptError) {
          console.error(`Error creating prompt for ${category} ${i + 1}:`, promptError);
          continue;
        }

        // Create the image entry
        const { data: imageData, error: imageError } = await supabase
          .from('images')
          .insert({
            image_url: imagePath,
            prompt_id: promptData.id,
            subcategory_id: subcategoryId,
            account_id: null,
            user_id: null,
            status: 'completed',
            metadata: {
              generated_for: 'sample_gallery',
              category: category,
              subcategory: subcategoryId
            }
          })
          .select()
          .single();

        if (imageError) {
          console.error(`Error creating image for ${category} ${i + 1}:`, imageError);
          continue;
        }

        console.log(`  ✅ Created ${category} image ${i + 1}: ${imagePath}`);
      }
    }

    console.log('🎉 Sample images seeding completed successfully!');
    console.log('📝 You can now see placeholder images in the designer instances tab');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
  }
}

// Run the seeding
seedSampleImages();
