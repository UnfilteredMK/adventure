-- Seed file for starting niches with sample images and prompts
-- This creates categories, subcategories, and sample images for the initial niches

BEGIN;

-- Insert main categories
INSERT INTO categories (id, name, description, status, instance_type, created_at, updated_at) VALUES
('cat-home-interior', 'Home Interior', 'Interior design and home improvement services', 'active', 'service', NOW(), NOW()),
('cat-home-exterior', 'Home Exterior', 'Exterior home improvement and landscaping services', 'active', 'service', NOW(), NOW()),
('cat-fashion-cosmetics', 'Fashion / Cosmetics / Try-Ons / Ecomm', 'Fashion, beauty, and e-commerce services', 'active', 'ecomm', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert subcategories for Home Interior
INSERT INTO categories_subcategories (
    id, category_id, subcategory, description, status, instance_type, 
    email_lead_price, phone_lead_price, created_at, updated_at
) VALUES
-- Home Interior subcategories
('sub-interior-design', 'cat-home-interior', 'Interior Design', 'Professional interior design services for homes and offices', 'active', 'service', 5.00, 8.00, NOW(), NOW()),
('sub-paint', 'cat-home-interior', 'Paint', 'Interior and exterior painting services', 'active', 'service', 3.00, 5.00, NOW(), NOW()),
('sub-flooring', 'cat-home-interior', 'Flooring', 'Hardwood, carpet, tile, and other flooring installation', 'active', 'service', 4.00, 6.00, NOW(), NOW()),
('sub-landscaping', 'cat-home-interior', 'Landscaping', 'Indoor plant design and garden landscaping', 'active', 'service', 4.00, 6.00, NOW(), NOW()),
('sub-basements', 'cat-home-interior', 'Basements', 'Basement finishing and renovation services', 'active', 'service', 6.00, 10.00, NOW(), NOW()),

-- Home Exterior subcategories
('sub-exterior-landscaping', 'cat-home-exterior', 'Landscaping', 'Outdoor landscaping and garden design', 'active', 'service', 4.00, 6.00, NOW(), NOW()),

-- Fashion/Cosmetics subcategories
('sub-furniture', 'cat-fashion-cosmetics', 'Furniture', 'Furniture design and retail', 'active', 'ecomm', 2.00, 3.00, NOW(), NOW()),
('sub-jewelry', 'cat-fashion-cosmetics', 'Jewelry', 'Jewelry design and retail', 'active', 'ecomm', 3.00, 4.00, NOW(), NOW()),
('sub-clothing', 'cat-fashion-cosmetics', 'Clothing', 'Fashion and clothing retail', 'active', 'ecomm', 2.00, 3.00, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert sample prompts for each subcategory
INSERT INTO prompts (id, prompt, variables, account_id, created_at, updated_at) VALUES
-- Interior Design prompts
('prompt-int-1', 'Modern minimalist living room with neutral colors, clean lines, and contemporary furniture', null, null, NOW(), NOW()),
('prompt-int-2', 'Cozy farmhouse kitchen with white cabinets, wooden countertops, and vintage accessories', null, null, NOW(), NOW()),
('prompt-int-3', 'Luxury master bedroom with king-size bed, elegant lighting, and sophisticated color scheme', null, null, NOW(), NOW()),
('prompt-int-4', 'Scandinavian-style dining room with light wood furniture and natural textures', null, null, NOW(), NOW()),
('prompt-int-5', 'Industrial loft space with exposed brick walls, metal fixtures, and urban aesthetic', null, null, NOW(), NOW()),
('prompt-int-6', 'Bohemian living room with eclectic furniture, plants, and vibrant textiles', null, null, NOW(), NOW()),
('prompt-int-7', 'Traditional formal dining room with dark wood furniture and classic elegance', null, null, NOW(), NOW()),
('prompt-int-8', 'Modern home office with sleek desk, ergonomic chair, and professional lighting', null, null, NOW(), NOW()),
('prompt-int-9', 'Mediterranean-style living room with warm colors, arched doorways, and rustic charm', null, null, NOW(), NOW()),
('prompt-int-10', 'Contemporary bathroom with marble surfaces, modern fixtures, and spa-like atmosphere', null, null, NOW(), NOW()),

-- Paint prompts
('prompt-paint-1', 'Accent wall with bold geometric pattern in navy blue and white', null, null, NOW(), NOW()),
('prompt-paint-2', 'Ombre wall effect transitioning from light blue to deep navy', null, null, NOW(), NOW()),
('prompt-paint-3', 'Two-tone bedroom walls with soft gray and crisp white', null, null, NOW(), NOW()),
('prompt-paint-4', 'Chalkboard wall in children''s room with colorful trim', null, null, NOW(), NOW()),
('prompt-paint-5', 'Metallic accent wall with gold geometric patterns', null, null, NOW(), NOW()),
('prompt-paint-6', 'Stenciled floral pattern on powder blue background', null, null, NOW(), NOW()),
('prompt-paint-7', 'Striped wall design with alternating white and sage green', null, null, NOW(), NOW()),
('prompt-paint-8', 'Textured paint finish with subtle color variations', null, null, NOW(), NOW()),
('prompt-paint-9', 'Color-blocked wall with modern geometric shapes', null, null, NOW(), NOW()),
('prompt-paint-10', 'Faux brick wall with whitewashed paint treatment', null, null, NOW(), NOW()),

-- Flooring prompts
('prompt-floor-1', 'Hardwood flooring with herringbone pattern in warm oak', null, null, NOW(), NOW()),
('prompt-floor-2', 'Luxury vinyl plank flooring with realistic wood grain texture', null, null, NOW(), NOW()),
('prompt-floor-3', 'Marble tile flooring with intricate geometric patterns', null, null, NOW(), NOW()),
('prompt-floor-4', 'Bamboo flooring with natural finish and sustainable appeal', null, null, NOW(), NOW()),
('prompt-floor-5', 'Carpet tiles with modern geometric design in neutral tones', null, null, NOW(), NOW()),
('prompt-floor-6', 'Porcelain tile with wood-look finish for wet areas', null, null, NOW(), NOW()),
('prompt-floor-7', 'Cork flooring with natural texture and eco-friendly properties', null, null, NOW(), NOW()),
('prompt-floor-8', 'Concrete polished floors with industrial modern aesthetic', null, null, NOW(), NOW()),
('prompt-floor-9', 'Mosaic tile floor with colorful Mediterranean patterns', null, null, NOW(), NOW()),
('prompt-floor-10', 'Engineered hardwood with wide planks and matte finish', null, null, NOW(), NOW()),

-- Landscaping (indoor) prompts
('prompt-landscape-1', 'Indoor vertical garden wall with various succulents and herbs', null, null, NOW(), NOW()),
('prompt-landscape-2', 'Tropical plant arrangement with large leafy plants and natural lighting', null, null, NOW(), NOW()),
('prompt-landscape-3', 'Modern terrarium display with geometric glass containers', null, null, NOW(), NOW()),
('prompt-landscape-4', 'Zen garden corner with rocks, sand, and minimalist plants', null, null, NOW(), NOW()),
('prompt-landscape-5', 'Hanging plant installation with macrame holders and trailing vines', null, null, NOW(), NOW()),
('prompt-landscape-6', 'Indoor herb garden with organized planters and natural wood', null, null, NOW(), NOW()),
('prompt-landscape-7', 'Large potted tree as room divider with modern planter', null, null, NOW(), NOW()),
('prompt-landscape-8', 'Colorful flower arrangement with seasonal blooms', null, null, NOW(), NOW()),
('prompt-landscape-9', 'Cactus and succulent garden with desert aesthetic', null, null, NOW(), NOW()),
('prompt-landscape-10', 'Indoor water feature with plants and natural stone', null, null, NOW(), NOW()),

-- Basements prompts
('prompt-basement-1', 'Finished basement home theater with comfortable seating and dark walls', null, null, NOW(), NOW()),
('prompt-basement-2', 'Basement home gym with rubber flooring and mirrored walls', null, null, NOW(), NOW()),
('prompt-basement-3', 'Basement wine cellar with custom shelving and climate control', null, null, NOW(), NOW()),
('prompt-basement-4', 'Basement playroom with bright colors and storage solutions', null, null, NOW(), NOW()),
('prompt-basement-5', 'Basement office space with built-in desk and storage', null, null, NOW(), NOW()),
('prompt-basement-6', 'Basement guest suite with bedroom and bathroom', null, null, NOW(), NOW()),
('prompt-basement-7', 'Basement bar area with counter seating and entertainment center', null, null, NOW(), NOW()),
('prompt-basement-8', 'Basement craft room with organized storage and work surfaces', null, null, NOW(), NOW()),
('prompt-basement-9', 'Basement laundry room with utility sink and folding station', null, null, NOW(), NOW()),
('prompt-basement-10', 'Basement storage room with custom shelving and organization', null, null, NOW(), NOW()),

-- Exterior Landscaping prompts
('prompt-ext-landscape-1', 'Front yard landscaping with native plants and stone pathways', null, null, NOW(), NOW()),
('prompt-ext-landscape-2', 'Backyard patio with outdoor kitchen and dining area', null, null, NOW(), NOW()),
('prompt-ext-landscape-3', 'Garden with raised beds and vegetable planting areas', null, null, NOW(), NOW()),
('prompt-ext-landscape-4', 'Pool area landscaping with tropical plants and privacy screening', null, null, NOW(), NOW()),
('prompt-ext-landscape-5', 'Xeriscape garden with drought-tolerant plants and rock features', null, null, NOW(), NOW()),
('prompt-ext-landscape-6', 'English cottage garden with mixed perennials and climbing roses', null, null, NOW(), NOW()),
('prompt-ext-landscape-7', 'Modern minimalist landscape with clean lines and sculptural plants', null, null, NOW(), NOW()),
('prompt-ext-landscape-8', 'Japanese garden with water features and zen elements', null, null, NOW(), NOW()),
('prompt-ext-landscape-9', 'Mediterranean landscape with olive trees and lavender', null, null, NOW(), NOW()),
('prompt-ext-landscape-10', 'Wildlife-friendly garden with native plants and bird feeders', null, null, NOW(), NOW()),

-- Furniture prompts
('prompt-furniture-1', 'Modern sectional sofa in neutral gray with clean lines', null, null, NOW(), NOW()),
('prompt-furniture-2', 'Rustic dining table with reclaimed wood and metal legs', null, null, NOW(), NOW()),
('prompt-furniture-3', 'Mid-century modern armchair with walnut frame and leather upholstery', null, null, NOW(), NOW()),
('prompt-furniture-4', 'Industrial bookshelf with metal frame and wooden shelves', null, null, NOW(), NOW()),
('prompt-furniture-5', 'Scandinavian coffee table with light wood and minimalist design', null, null, NOW(), NOW()),
('prompt-furniture-6', 'Vintage dresser with ornate details and antique finish', null, null, NOW(), NOW()),
('prompt-furniture-7', 'Contemporary bed frame with upholstered headboard', null, null, NOW(), NOW()),
('prompt-furniture-8', 'Modular storage system with customizable configurations', null, null, NOW(), NOW()),
('prompt-furniture-9', 'Outdoor patio set with weather-resistant materials', null, null, NOW(), NOW()),
('prompt-furniture-10', 'Office desk with built-in storage and cable management', null, null, NOW(), NOW()),

-- Jewelry prompts
('prompt-jewelry-1', 'Elegant gold necklace with delicate chain and pendant', null, null, NOW(), NOW()),
('prompt-jewelry-2', 'Vintage-inspired ring with gemstone and intricate setting', null, null, NOW(), NOW()),
('prompt-jewelry-3', 'Modern earrings with geometric shapes and minimalist design', null, null, NOW(), NOW()),
('prompt-jewelry-4', 'Pearl bracelet with multiple strands and clasp closure', null, null, NOW(), NOW()),
('prompt-jewelry-5', 'Statement necklace with bold colors and artistic design', null, null, NOW(), NOW()),
('prompt-jewelry-6', 'Diamond engagement ring with solitaire setting', null, null, NOW(), NOW()),
('prompt-jewelry-7', 'Bohemian bracelet with mixed metals and natural stones', null, null, NOW(), NOW()),
('prompt-jewelry-8', 'Luxury watch with leather strap and classic design', null, null, NOW(), NOW()),
('prompt-jewelry-9', 'Artisan brooch with handcrafted details and unique materials', null, null, NOW(), NOW()),
('prompt-jewelry-10', 'Charm bracelet with personalized elements and meaningful symbols', null, null, NOW(), NOW()),

-- Clothing prompts
('prompt-clothing-1', 'Casual summer dress with floral print and flowing silhouette', null, null, NOW(), NOW()),
('prompt-clothing-2', 'Business suit with tailored fit and professional styling', null, null, NOW(), NOW()),
('prompt-clothing-3', 'Denim jacket with vintage wash and classic cut', null, null, NOW(), NOW()),
('prompt-clothing-4', 'Athletic wear with moisture-wicking fabric and modern design', null, null, NOW(), NOW()),
('prompt-clothing-5', 'Evening gown with elegant draping and sophisticated details', null, null, NOW(), NOW()),
('prompt-clothing-6', 'Winter coat with wool blend and contemporary styling', null, null, NOW(), NOW()),
('prompt-clothing-7', 'Bohemian blouse with loose fit and artistic patterns', null, null, NOW(), NOW()),
('prompt-clothing-8', 'Formal shirt with crisp cotton and classic collar', null, null, NOW(), NOW()),
('prompt-clothing-9', 'Activewear set with coordinating pieces and performance fabric', null, null, NOW(), NOW()),
('prompt-clothing-10', 'Vintage-inspired dress with retro styling and modern comfort', null, null, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert sample images (using placeholder URLs that can be replaced with actual generated images)
INSERT INTO images (
    id, image_url, prompt_id, subcategory_id, account_id, user_id, 
    status, created_at, updated_at, metadata
) VALUES
-- Interior Design images
('img-int-1', '/public/sample-images/interior-design-1.jpg', 'prompt-int-1', 'sub-interior-design', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Interior Design"}'),
('img-int-2', '/public/sample-images/interior-design-2.jpg', 'prompt-int-2', 'sub-interior-design', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Interior Design"}'),
('img-int-3', '/public/sample-images/interior-design-3.jpg', 'prompt-int-3', 'sub-interior-design', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Interior Design"}'),
('img-int-4', '/public/sample-images/interior-design-4.jpg', 'prompt-int-4', 'sub-interior-design', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Interior Design"}'),
('img-int-5', '/public/sample-images/interior-design-5.jpg', 'prompt-int-5', 'sub-interior-design', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Interior Design"}'),

-- Paint images
('img-paint-1', '/public/sample-images/paint-1.jpg', 'prompt-paint-1', 'sub-paint', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Paint"}'),
('img-paint-2', '/public/sample-images/paint-2.jpg', 'prompt-paint-2', 'sub-paint', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Paint"}'),
('img-paint-3', '/public/sample-images/paint-3.jpg', 'prompt-paint-3', 'sub-paint', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Paint"}'),
('img-paint-4', '/public/sample-images/paint-4.jpg', 'prompt-paint-4', 'sub-paint', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Paint"}'),
('img-paint-5', '/public/sample-images/paint-5.jpg', 'prompt-paint-5', 'sub-paint', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Paint"}'),

-- Flooring images
('img-floor-1', '/public/sample-images/flooring-1.jpg', 'prompt-floor-1', 'sub-flooring', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Flooring"}'),
('img-floor-2', '/public/sample-images/flooring-2.jpg', 'prompt-floor-2', 'sub-flooring', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Flooring"}'),
('img-floor-3', '/public/sample-images/flooring-3.jpg', 'prompt-floor-3', 'sub-flooring', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Flooring"}'),
('img-floor-4', '/public/sample-images/flooring-4.jpg', 'prompt-floor-4', 'sub-flooring', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Flooring"}'),
('img-floor-5', '/public/sample-images/flooring-5.jpg', 'prompt-floor-5', 'sub-flooring', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Flooring"}'),

-- Landscaping (indoor) images
('img-landscape-1', '/public/sample-images/landscaping-1.jpg', 'prompt-landscape-1', 'sub-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Landscaping"}'),
('img-landscape-2', '/public/sample-images/landscaping-2.jpg', 'prompt-landscape-2', 'sub-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Landscaping"}'),
('img-landscape-3', '/public/sample-images/landscaping-3.jpg', 'prompt-landscape-3', 'sub-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Landscaping"}'),
('img-landscape-4', '/public/sample-images/landscaping-4.jpg', 'prompt-landscape-4', 'sub-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Landscaping"}'),
('img-landscape-5', '/public/sample-images/landscaping-5.jpg', 'prompt-landscape-5', 'sub-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Landscaping"}'),

-- Basements images
('img-basement-1', '/public/sample-images/basements-1.jpg', 'prompt-basement-1', 'sub-basements', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Basements"}'),
('img-basement-2', '/public/sample-images/basements-2.jpg', 'prompt-basement-2', 'sub-basements', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Basements"}'),
('img-basement-3', '/public/sample-images/basements-3.jpg', 'prompt-basement-3', 'sub-basements', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Basements"}'),
('img-basement-4', '/public/sample-images/basements-4.jpg', 'prompt-basement-4', 'sub-basements', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Basements"}'),
('img-basement-5', '/public/sample-images/basements-5.jpg', 'prompt-basement-5', 'sub-basements', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Interior", "subcategory": "Basements"}'),

-- Exterior Landscaping images
('img-ext-landscape-1', '/public/sample-images/exterior-landscaping-1.jpg', 'prompt-ext-landscape-1', 'sub-exterior-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Exterior", "subcategory": "Landscaping"}'),
('img-ext-landscape-2', '/public/sample-images/exterior-landscaping-2.jpg', 'prompt-ext-landscape-2', 'sub-exterior-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Exterior", "subcategory": "Landscaping"}'),
('img-ext-landscape-3', '/public/sample-images/exterior-landscaping-3.jpg', 'prompt-ext-landscape-3', 'sub-exterior-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Exterior", "subcategory": "Landscaping"}'),
('img-ext-landscape-4', '/public/sample-images/exterior-landscaping-4.jpg', 'prompt-ext-landscape-4', 'sub-exterior-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Exterior", "subcategory": "Landscaping"}'),
('img-ext-landscape-5', '/public/sample-images/exterior-landscaping-5.jpg', 'prompt-ext-landscape-5', 'sub-exterior-landscaping', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Home Exterior", "subcategory": "Landscaping"}'),

-- Furniture images
('img-furniture-1', '/public/sample-images/furniture-1.jpg', 'prompt-furniture-1', 'sub-furniture', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Furniture"}'),
('img-furniture-2', '/public/sample-images/furniture-2.jpg', 'prompt-furniture-2', 'sub-furniture', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Furniture"}'),
('img-furniture-3', '/public/sample-images/furniture-3.jpg', 'prompt-furniture-3', 'sub-furniture', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Furniture"}'),
('img-furniture-4', '/public/sample-images/furniture-4.jpg', 'prompt-furniture-4', 'sub-furniture', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Furniture"}'),
('img-furniture-5', '/public/sample-images/furniture-5.jpg', 'prompt-furniture-5', 'sub-furniture', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Furniture"}'),

-- Jewelry images
('img-jewelry-1', '/public/sample-images/jewelry-1.jpg', 'prompt-jewelry-1', 'sub-jewelry', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Jewelry"}'),
('img-jewelry-2', '/public/sample-images/jewelry-2.jpg', 'prompt-jewelry-2', 'sub-jewelry', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Jewelry"}'),
('img-jewelry-3', '/public/sample-images/jewelry-3.jpg', 'prompt-jewelry-3', 'sub-jewelry', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Jewelry"}'),
('img-jewelry-4', '/public/sample-images/jewelry-4.jpg', 'prompt-jewelry-4', 'sub-jewelry', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Jewelry"}'),
('img-jewelry-5', '/public/sample-images/jewelry-5.jpg', 'prompt-jewelry-5', 'sub-jewelry', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Jewelry"}'),

-- Clothing images
('img-clothing-1', '/public/sample-images/clothing-1.jpg', 'prompt-clothing-1', 'sub-clothing', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Clothing"}'),
('img-clothing-2', '/public/sample-images/clothing-2.jpg', 'prompt-clothing-2', 'sub-clothing', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Clothing"}'),
('img-clothing-3', '/public/sample-images/clothing-3.jpg', 'prompt-clothing-3', 'sub-clothing', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Clothing"}'),
('img-clothing-4', '/public/sample-images/clothing-4.jpg', 'prompt-clothing-4', 'sub-clothing', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Clothing"}'),
('img-clothing-5', '/public/sample-images/clothing-5.jpg', 'prompt-clothing-5', 'sub-clothing', null, null, 'completed', NOW(), NOW(), '{"generated_for": "sample_gallery", "category": "Fashion / Cosmetics / Try-Ons / Ecomm", "subcategory": "Clothing"}')
ON CONFLICT (id) DO NOTHING;

-- Update subcategories with sample images
UPDATE categories_subcategories 
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/sample-images/interior-design-1.jpg', 'alt', 'Interior Design example 1'),
    jsonb_build_object('url', '/public/sample-images/interior-design-2.jpg', 'alt', 'Interior Design example 2'),
    jsonb_build_object('url', '/public/sample-images/interior-design-3.jpg', 'alt', 'Interior Design example 3')
  )
)
WHERE id = 'sub-interior-design';

UPDATE categories_subcategories 
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/sample-images/paint-1.jpg', 'alt', 'Paint example 1'),
    jsonb_build_object('url', '/public/sample-images/paint-2.jpg', 'alt', 'Paint example 2'),
    jsonb_build_object('url', '/public/sample-images/paint-3.jpg', 'alt', 'Paint example 3')
  )
)
WHERE id = 'sub-paint';

UPDATE categories_subcategories 
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/sample-images/flooring-1.jpg', 'alt', 'Flooring example 1'),
    jsonb_build_object('url', '/public/sample-images/flooring-2.jpg', 'alt', 'Flooring example 2'),
    jsonb_build_object('url', '/public/sample-images/flooring-3.jpg', 'alt', 'Flooring example 3')
  )
)
WHERE id = 'sub-flooring';

UPDATE categories_subcategories 
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/sample-images/landscaping-1.jpg', 'alt', 'Landscaping example 1'),
    jsonb_build_object('url', '/public/sample-images/landscaping-2.jpg', 'alt', 'Landscaping example 2'),
    jsonb_build_object('url', '/public/sample-images/landscaping-3.jpg', 'alt', 'Landscaping example 3')
  )
)
WHERE id = 'sub-landscaping';

UPDATE categories_subcategories 
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/sample-images/basements-1.jpg', 'alt', 'Basements example 1'),
    jsonb_build_object('url', '/public/sample-images/basements-2.jpg', 'alt', 'Basements example 2'),
    jsonb_build_object('url', '/public/sample-images/basements-3.jpg', 'alt', 'Basements example 3')
  )
)
WHERE id = 'sub-basements';

UPDATE categories_subcategories 
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/sample-images/exterior-landscaping-1.jpg', 'alt', 'Exterior Landscaping example 1'),
    jsonb_build_object('url', '/public/sample-images/exterior-landscaping-2.jpg', 'alt', 'Exterior Landscaping example 2'),
    jsonb_build_object('url', '/public/sample-images/exterior-landscaping-3.jpg', 'alt', 'Exterior Landscaping example 3')
  )
)
WHERE id = 'sub-exterior-landscaping';

UPDATE categories_subcategories 
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/sample-images/furniture-1.jpg', 'alt', 'Furniture example 1'),
    jsonb_build_object('url', '/public/sample-images/furniture-2.jpg', 'alt', 'Furniture example 2'),
    jsonb_build_object('url', '/public/sample-images/furniture-3.jpg', 'alt', 'Furniture example 3')
  )
)
WHERE id = 'sub-furniture';

UPDATE categories_subcategories 
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/sample-images/jewelry-1.jpg', 'alt', 'Jewelry example 1'),
    jsonb_build_object('url', '/public/sample-images/jewelry-2.jpg', 'alt', 'Jewelry example 2'),
    jsonb_build_object('url', '/public/sample-images/jewelry-3.jpg', 'alt', 'Jewelry example 3')
  )
)
WHERE id = 'sub-jewelry';

UPDATE categories_subcategories 
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/sample-images/clothing-1.jpg', 'alt', 'Clothing example 1'),
    jsonb_build_object('url', '/public/sample-images/clothing-2.jpg', 'alt', 'Clothing example 2'),
    jsonb_build_object('url', '/public/sample-images/clothing-3.jpg', 'alt', 'Clothing example 3')
  )
)
WHERE id = 'sub-clothing';

COMMIT;
