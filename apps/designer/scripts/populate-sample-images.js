#!/usr/bin/env node

/**
 * Script to populate the database with sample images and prompts for starting niches
 * This creates a comprehensive set of sample data for all categories and subcategories
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function buildSuggestionLabel(fullPrompt, preferredShort, maxLen = 50) {
  const pref = String(preferredShort || '').trim();
  if (pref) {
    return pref.length <= maxLen ? pref : `${pref.slice(0, Math.max(0, maxLen - 1))}…`;
  }
  const p = String(fullPrompt || '').trim();
  if (!p) return '';
  return p.length <= maxLen ? p : `${p.slice(0, Math.max(0, maxLen - 1))}…`;
}

// Sample data for different niches
const sampleData = {
  categories: [
    {
      name: 'Fashion',
      description: 'Fashion and clothing related services',
      subcategories: [
        {
          name: 'Women\'s Clothing',
          description: 'Professional women\'s fashion and apparel',
          prompts: [
            'Elegant women\'s business suit with modern tailoring, professional photography, clean background, no text',
            'Stylish women\'s evening dress with sophisticated design, high-end fashion photography, no text',
            'Contemporary women\'s casual wear with trendy styling, clean aesthetic, no text',
            'Professional women\'s blouse with classic design, minimalist presentation, no text',
            'Fashionable women\'s accessories with luxury appeal, clean background, no text',
            'Modern women\'s outerwear with contemporary styling, professional photography, no text'
          ]
        },
        {
          name: 'Men\'s Clothing',
          description: 'Professional men\'s fashion and apparel',
          prompts: [
            'Sharp men\'s business suit with professional tailoring, clean background, no text',
            'Stylish men\'s casual shirt with modern design, minimalist presentation, no text',
            'Elegant men\'s formal wear with sophisticated styling, professional photography, no text',
            'Contemporary men\'s jacket with trendy design, clean aesthetic, no text',
            'Professional men\'s accessories with luxury appeal, clean background, no text',
            'Modern men\'s outerwear with contemporary styling, professional photography, no text'
          ]
        },
        {
          name: 'Accessories',
          description: 'Fashion accessories and jewelry',
          prompts: [
            'Luxury handbag with elegant design, professional photography, clean background, no text',
            'Stylish watch with sophisticated appeal, minimalist presentation, no text',
            'Fashionable jewelry with modern design, clean aesthetic, no text',
            'Designer sunglasses with contemporary styling, professional photography, no text',
            'Elegant scarf with luxury appeal, clean background, no text',
            'Modern belt with sophisticated design, minimalist presentation, no text'
          ]
        }
      ]
    },
    {
      name: 'Interior Design',
      description: 'Home and interior design services',
      subcategories: [
        {
          name: 'Living Room',
          description: 'Living room design and furniture',
          prompts: [
            'Modern living room with contemporary furniture, clean design, professional photography, no text',
            'Cozy living room with warm lighting and comfortable seating, elegant presentation, no text',
            'Minimalist living room with sleek furniture, clean aesthetic, no text',
            'Luxury living room with sophisticated decor, professional photography, no text',
            'Contemporary living room with trendy furniture, clean background, no text',
            'Elegant living room with classic design elements, minimalist presentation, no text'
          ]
        },
        {
          name: 'Kitchen',
          description: 'Kitchen design and appliances',
          prompts: [
            'Modern kitchen with sleek appliances, clean design, professional photography, no text',
            'Contemporary kitchen with island and modern cabinetry, elegant presentation, no text',
            'Luxury kitchen with high-end appliances, sophisticated styling, no text',
            'Minimalist kitchen with clean lines, professional photography, no text',
            'Farmhouse kitchen with rustic charm, warm aesthetic, no text',
            'Industrial kitchen with modern fixtures, contemporary design, no text'
          ]
        },
        {
          name: 'Bedroom',
          description: 'Bedroom design and furniture',
          prompts: [
            'Master bedroom with elegant furniture, sophisticated design, professional photography, no text',
            'Modern bedroom with contemporary styling, clean aesthetic, no text',
            'Luxury bedroom with premium bedding, elegant presentation, no text',
            'Minimalist bedroom with sleek furniture, professional photography, no text',
            'Cozy bedroom with warm lighting, comfortable design, no text',
            'Contemporary bedroom with trendy decor, clean background, no text'
          ]
        }
      ]
    },
    {
      name: 'Landscaping',
      description: 'Outdoor landscaping and garden design',
      subcategories: [
        {
          name: 'Garden Design',
          description: 'Garden landscaping and plant design',
          prompts: [
            'Beautiful garden with colorful flowers and plants, professional photography, no text',
            'Modern garden design with contemporary landscaping, clean aesthetic, no text',
            'Luxury garden with sophisticated plant arrangements, elegant presentation, no text',
            'Minimalist garden with clean lines and modern plants, professional photography, no text',
            'Tropical garden with exotic plants, lush design, no text',
            'English garden with classic plant arrangements, elegant styling, no text'
          ]
        },
        {
          name: 'Outdoor Living',
          description: 'Outdoor living spaces and patios',
          prompts: [
            'Modern outdoor patio with contemporary furniture, clean design, professional photography, no text',
            'Luxury outdoor living space with sophisticated seating, elegant presentation, no text',
            'Contemporary outdoor deck with modern amenities, clean aesthetic, no text',
            'Cozy outdoor seating area with warm lighting, comfortable design, no text',
            'Minimalist outdoor space with sleek furniture, professional photography, no text',
            'Elegant outdoor dining area with sophisticated styling, clean background, no text'
          ]
        },
        {
          name: 'Pool Design',
          description: 'Swimming pool and water feature design',
          prompts: [
            'Modern swimming pool with contemporary design, professional photography, no text',
            'Luxury pool with sophisticated landscaping, elegant presentation, no text',
            'Infinity pool with stunning views, clean aesthetic, no text',
            'Minimalist pool design with sleek lines, professional photography, no text',
            'Tropical pool with lush surroundings, exotic design, no text',
            'Contemporary pool with modern features, clean background, no text'
          ]
        }
      ]
    },
    {
      name: 'Hair Salon',
      description: 'Hair salon and beauty services',
      subcategories: [
        {
          name: 'Hair Styling',
          description: 'Hair styling and cutting services',
          prompts: [
            'Professional hair salon interior with modern styling stations, clean design, no text',
            'Stylish haircut showcase with professional lighting, elegant presentation, no text',
            'Contemporary salon with sleek furniture, professional photography, no text',
            'Luxury salon with sophisticated decor, clean aesthetic, no text',
            'Modern salon with trendy styling stations, minimalist presentation, no text',
            'Elegant salon with classic design elements, professional photography, no text'
          ]
        },
        {
          name: 'Hair Color',
          description: 'Hair coloring and treatment services',
          prompts: [
            'Professional hair coloring station with modern equipment, clean design, no text',
            'Stylish hair color showcase with professional lighting, elegant presentation, no text',
            'Contemporary color bar with sleek design, professional photography, no text',
            'Luxury hair treatment area with sophisticated styling, clean aesthetic, no text',
            'Modern color mixing station with trendy equipment, minimalist presentation, no text',
            'Elegant hair color consultation area, professional photography, no text'
          ]
        },
        {
          name: 'Salon Interior',
          description: 'Salon interior design and layout',
          prompts: [
            'Modern salon interior with contemporary design, professional photography, no text',
            'Luxury salon with sophisticated decor and lighting, elegant presentation, no text',
            'Minimalist salon with clean lines and modern furniture, clean aesthetic, no text',
            'Contemporary salon with trendy styling stations, professional photography, no text',
            'Elegant salon with classic design elements, clean background, no text',
            'Stylish salon with modern amenities, sophisticated styling, no text'
          ]
        }
      ]
    },
    {
      name: 'Furniture Store',
      description: 'Furniture retail and showroom design',
      subcategories: [
        {
          name: 'Living Room Furniture',
          description: 'Living room furniture and seating',
          prompts: [
            'Modern living room furniture set with contemporary design, professional photography, no text',
            'Luxury sofa with sophisticated styling, elegant presentation, no text',
            'Contemporary coffee table with sleek design, clean aesthetic, no text',
            'Elegant armchair with classic styling, professional photography, no text',
            'Modern entertainment center with contemporary design, clean background, no text',
            'Stylish bookshelf with sophisticated appeal, minimalist presentation, no text'
          ]
        },
        {
          name: 'Bedroom Furniture',
          description: 'Bedroom furniture and storage',
          prompts: [
            'Modern bedroom furniture set with contemporary design, professional photography, no text',
            'Luxury bed frame with sophisticated styling, elegant presentation, no text',
            'Contemporary dresser with sleek design, clean aesthetic, no text',
            'Elegant nightstand with classic styling, professional photography, no text',
            'Modern wardrobe with contemporary design, clean background, no text',
            'Stylish storage solution with sophisticated appeal, minimalist presentation, no text'
          ]
        },
        {
          name: 'Office Furniture',
          description: 'Office furniture and workspace design',
          prompts: [
            'Modern office desk with contemporary design, professional photography, no text',
            'Luxury office chair with sophisticated styling, elegant presentation, no text',
            'Contemporary filing cabinet with sleek design, clean aesthetic, no text',
            'Elegant bookshelf with classic styling, professional photography, no text',
            'Modern conference table with contemporary design, clean background, no text',
            'Stylish office storage with sophisticated appeal, minimalist presentation, no text'
          ]
        }
      ]
    }
  ]
};

// Sample image URLs (placeholder URLs - in production these would be actual generated images)
const sampleImageUrls = [
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1024&h=1024&fit=crop&crop=center',
  'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1024&h=1024&fit=crop&crop=center',
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1024&h=1024&fit=crop&crop=center',
  'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1024&h=1024&fit=crop&crop=center',
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1024&h=1024&fit=crop&crop=center',
  'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1024&h=1024&fit=crop&crop=center'
];

async function createSampleData() {
  console.log('🚀 Starting to populate database with sample images and prompts...\n');

  try {
    // First, let's get or create a test account
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('id')
      .limit(1);

    if (accountsError) {
      console.error('❌ Error fetching accounts:', accountsError);
      return;
    }

    let accountId;
    if (accounts && accounts.length > 0) {
      accountId = accounts[0].id;
      console.log(`📋 Using existing account: ${accountId}`);
    } else {
      // Create a test account
      const { data: newAccount, error: createAccountError } = await supabase
        .from('accounts')
        .insert({
          name: 'Sample Account',
          description: 'Account for sample data'
        })
        .select()
        .single();

      if (createAccountError) {
        console.error('❌ Error creating account:', createAccountError);
        return;
      }

      accountId = newAccount.id;
      console.log(`📋 Created new account: ${accountId}`);
    }

    // Process each category
    for (const category of sampleData.categories) {
      console.log(`\n📁 Processing category: ${category.name}`);

      // Create or get category
      const { data: existingCategory, error: categoryCheckError } = await supabase
        .from('categories')
        .select('id')
        .eq('name', category.name)
        .single();

      let categoryId;
      if (existingCategory) {
        categoryId = existingCategory.id;
        console.log(`   ✅ Found existing category: ${category.name}`);
      } else {
        const { data: newCategory, error: createCategoryError } = await supabase
          .from('categories')
          .insert({
            name: category.name,
            description: category.description
          })
          .select()
          .single();

        if (createCategoryError) {
          console.error(`   ❌ Error creating category ${category.name}:`, createCategoryError);
          continue;
        }

        categoryId = newCategory.id;
        console.log(`   ✅ Created category: ${category.name}`);
      }

      // Process each subcategory
      for (const subcategory of category.subcategories) {
        console.log(`   📂 Processing subcategory: ${subcategory.name}`);

        // Create or get subcategory
        const { data: existingSubcategory, error: subcategoryCheckError } = await supabase
          .from('categories_subcategories')
          .select('id')
          .eq('subcategory', subcategory.name)
          .eq('category_id', categoryId)
          .single();

        let subcategoryId;
        if (existingSubcategory) {
          subcategoryId = existingSubcategory.id;
          console.log(`      ✅ Found existing subcategory: ${subcategory.name}`);
        } else {
          const { data: newSubcategory, error: createSubcategoryError } = await supabase
            .from('categories_subcategories')
            .insert({
              subcategory: subcategory.name,
              description: subcategory.description,
              category_id: categoryId
            })
            .select()
            .single();

          if (createSubcategoryError) {
            console.error(`      ❌ Error creating subcategory ${subcategory.name}:`, createSubcategoryError);
            continue;
          }

          subcategoryId = newSubcategory.id;
          console.log(`      ✅ Created subcategory: ${subcategory.name}`);
        }

        // Create prompts and images for this subcategory
        for (let i = 0; i < subcategory.prompts.length; i++) {
          const prompt = subcategory.prompts[i];
          const imageUrl = sampleImageUrls[i % sampleImageUrls.length];

          // Create prompt
          const { data: promptData, error: promptError } = await supabase
            .from('prompts')
            .insert({
              prompt: prompt,
              subcategory_id: subcategoryId,
              variables: null,
              suggestion_label: buildSuggestionLabel(prompt),
            })
            .select()
            .single();

          if (promptError) {
            console.error(`      ❌ Error creating prompt:`, promptError);
            continue;
          }

          // Create image
          const { data: imageData, error: imageError } = await supabase
            .from('images')
            .insert({
              image_url: imageUrl,
              prompt_id: promptData.id,
              subcategory_id: subcategoryId,
              account_id: accountId,
              model_id: null, // Set to null since we don't have a UUID for the model
              negative_prompt: 'text, words, writing, letters, numbers, symbols, labels, captions, watermarks, signatures, not the model please, no text, no words, no writing, no letters, no numbers, no symbols, no labels, no captions, no watermarks, no signatures',
              metadata: {
                generated_for: 'sample_gallery',
                subcategory: subcategory.name,
                category: category.name,
                prompt_text: prompt,
                generation_index: i,
                ai_model: 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
                model_name: 'Stable Diffusion XL',
                model_provider: 'Replicate',
                sample_data: true
              },
              status: 'completed'
            })
            .select()
            .single();

          if (imageError) {
            console.error(`      ❌ Error creating image:`, imageError);
            continue;
          }

          console.log(`      ✅ Created image ${i + 1}/${subcategory.prompts.length} for ${subcategory.name}`);
        }
      }
    }

    console.log('\n🎉 Successfully populated database with sample images and prompts!');
    console.log('\n📊 Summary:');
    console.log(`   - Categories: ${sampleData.categories.length}`);
    console.log(`   - Total subcategories: ${sampleData.categories.reduce((sum, cat) => sum + cat.subcategories.length, 0)}`);
    console.log(`   - Total images created: ${sampleData.categories.reduce((sum, cat) => sum + cat.subcategories.reduce((subSum, sub) => subSum + sub.prompts.length, 0), 0)}`);

  } catch (error) {
    console.error('❌ Error during population:', error);
  }
}

// Run the script
createSampleData()
  .then(() => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
