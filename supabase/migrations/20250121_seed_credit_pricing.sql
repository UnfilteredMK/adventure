-- Seed credit pricing for existing subcategories
-- E-commerce: 1-2 credits (affordable for online stores)
-- Services: 2-5 credits (based on service value/pricing)

BEGIN;

-- Update e-commerce subcategories to lower credit prices (1-2 credits)
UPDATE categories_subcategories 
SET credit_price = 1
WHERE instance_type = 'ecomm' 
AND subcategory IN (
  'Product Photography', 'Fashion Photography', 'Jewelry Photography',
  'Electronics Photography', 'Home Decor Photography', 'Beauty Products',
  'Food Photography', 'Pet Products', 'Sports Equipment', 'Toys & Games',
  'Books & Media', 'Health & Wellness Products', 'Automotive Parts',
  'Garden & Outdoor', 'Office Supplies', 'Baby Products'
);

UPDATE categories_subcategories 
SET credit_price = 2
WHERE instance_type = 'ecomm' 
AND subcategory IN (
  'Luxury Items', 'High-End Fashion', 'Premium Electronics', 'Art & Collectibles',
  'Fine Jewelry', 'Luxury Watches', 'Designer Handbags', 'Premium Cosmetics'
);

-- Update service subcategories based on service value/pricing tiers

-- Low-value services (2 credits)
UPDATE categories_subcategories 
SET credit_price = 2
WHERE instance_type = 'service' 
AND subcategory IN (
  'House Cleaning', 'Pet Grooming', 'Basic Lawn Care', 'Window Cleaning',
  'Carpet Cleaning', 'Pressure Washing', 'Basic Handyman', 'Light Fixture Installation',
  'Basic Plumbing', 'Basic Electrical', 'Painting (Interior)', 'Basic Landscaping',
  'Pool Maintenance', 'Gutter Cleaning', 'Basic HVAC', 'Appliance Repair',
  'Basic Computer Repair', 'Basic Photography', 'Basic Writing', 'Basic Design',
  'Basic Marketing', 'Basic Accounting', 'Basic Legal', 'Basic Consulting'
);

-- Medium-value services (3 credits)
UPDATE categories_subcategories 
SET credit_price = 3
WHERE instance_type = 'service' 
AND subcategory IN (
  'Kitchen Remodeling', 'Bathroom Remodeling', 'Flooring Installation', 'Roof Repair',
  'HVAC Installation', 'Electrical Work', 'Plumbing Work', 'Deck Building',
  'Fence Installation', 'Driveway Paving', 'Siding Installation', 'Window Replacement',
  'Door Installation', 'Garage Door Repair', 'Water Heater Installation', 'Furnace Repair',
  'Air Conditioning Repair', 'Pool Installation', 'Landscaping Design', 'Tree Services',
  'Pest Control', 'Security System Installation', 'Home Automation', 'Solar Installation',
  'Photography Services', 'Video Production', 'Web Design', 'Graphic Design',
  'Marketing Services', 'SEO Services', 'Social Media Management', 'Content Creation',
  'Business Consulting', 'Financial Planning', 'Tax Preparation', 'Legal Services',
  'Real Estate Services', 'Insurance Services', 'Travel Planning', 'Event Planning'
);

-- High-value services (4 credits)
UPDATE categories_subcategories 
SET credit_price = 4
WHERE instance_type = 'service' 
AND subcategory IN (
  'Full Home Remodeling', 'Commercial Construction', 'Industrial Construction',
  'Custom Home Building', 'Architectural Services', 'Engineering Services',
  'Project Management', 'Quality Assurance', 'Safety Consulting', 'Environmental Consulting',
  'IT Consulting', 'Software Development', 'App Development', 'Database Management',
  'Cloud Services', 'Cybersecurity', 'Network Administration', 'System Administration',
  'Digital Marketing', 'Brand Strategy', 'Creative Direction', 'Art Direction',
  'Professional Photography', 'Commercial Photography', 'Wedding Photography',
  'Event Photography', 'Product Photography', 'Real Estate Photography',
  'Video Production', 'Commercial Video', 'Documentary Production', 'Animation',
  '3D Modeling', 'Virtual Reality', 'Augmented Reality', 'Game Development',
  'E-commerce Development', 'Mobile App Development', 'Web Application Development',
  'Custom Software', 'Enterprise Software', 'API Development', 'Integration Services'
);

-- Premium services (5 credits)
UPDATE categories_subcategories 
SET credit_price = 5
WHERE instance_type = 'service' 
AND subcategory IN (
  'Roofing', 'Roof Replacement', 'Commercial Roofing', 'Industrial Roofing',
  'High-End Construction', 'Luxury Home Building', 'Mansion Construction',
  'Commercial Real Estate', 'Industrial Real Estate', 'Luxury Real Estate',
  'High-End Photography', 'Fashion Photography', 'Celebrity Photography',
  'Luxury Event Planning', 'Wedding Planning', 'Corporate Event Planning',
  'Luxury Travel Planning', 'Private Jet Services', 'Yacht Services',
  'Luxury Car Services', 'Personal Concierge', 'Luxury Lifestyle Management',
  'High-End Legal Services', 'Corporate Law', 'Entertainment Law', 'Intellectual Property',
  'Investment Banking', 'Private Equity', 'Hedge Fund Management', 'Wealth Management',
  'Luxury Brand Management', 'High-End Marketing', 'Luxury PR', 'Celebrity Management',
  'Medical Services', 'Dental Services', 'Veterinary Services', 'Mental Health Services',
  'Therapy Services', 'Counseling Services', 'Life Coaching', 'Executive Coaching',
  'Luxury Interior Design', 'Commercial Interior Design', 'Luxury Landscaping',
  'High-End Security', 'Executive Protection', 'Private Investigation',
  'Luxury Transportation', 'Private Aviation', 'Luxury Hospitality'
);

-- Set default credit price for any remaining NULL values
UPDATE categories_subcategories 
SET credit_price = 2
WHERE credit_price IS NULL;

COMMIT;
