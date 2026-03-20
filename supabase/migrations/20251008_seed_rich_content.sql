BEGIN;

-- Seed long-form content_md (HTML) where missing/empty
UPDATE public.categories_subcategories AS cs
SET content_md = (
  '<h2>What is ' || cs.subcategory || '?</h2>' ||
  '<p>Adventure lets customers preview ' || cs.subcategory || ' before they commit. This reduces uncertainty and speeds up decisions.</p>' ||
  '<h3>Why it matters</h3>' ||
  '<ul>' ||
    '<li>Higher confidence leads to more conversions</li>' ||
    '<li>Reduced returns and fewer no-shows</li>' ||
    '<li>Clear expectations for better satisfaction</li>' ||
  '</ul>' ||
  '<h3>How it works</h3>' ||
  '<ol>' ||
    '<li>Upload photos or choose templates</li>' ||
    '<li>Customize options to match brand and needs</li>' ||
    '<li>Share before/after results and capture leads</li>' ||
  '</ol>' ||
  '<h3>Getting started</h3>' ||
  '<p>Add the widget to your site in minutes. Configure branding, inputs, and output quality for ' || cs.subcategory || '.</p>'
)
WHERE (cs.content_md IS NULL OR length(btrim(cs.content_md)) = 0) AND cs.status = 'active';

-- Seed 6-8 FAQ items where missing/short
UPDATE public.categories_subcategories AS cs
SET faq = (
  jsonb_build_array(
    jsonb_build_object('question', 'How does ' || cs.subcategory || ' preview work?', 'answer', 'Customers upload images or select templates and instantly see realistic previews to guide decisions.'),
    jsonb_build_object('question', 'Does this support mobile?', 'answer', 'Yes. The widget is responsive and optimized for modern mobile browsers.'),
    jsonb_build_object('question', 'Can we customize branding?', 'answer', 'You can control logos, colors, copy, and input options from your dashboard.'),
    jsonb_build_object('question', 'Will this reduce returns/no-shows?', 'answer', 'Showing outcomes upfront aligns expectations, which reduces returns and missed appointments.'),
    jsonb_build_object('question', 'How do we embed on our site?', 'answer', 'Paste a lightweight script tag and initialize with your key. Most CMS and storefronts are supported.'),
    jsonb_build_object('question', 'What about performance?', 'answer', 'We cache and stream results. Most previews render in seconds with minimal impact on page speed.'),
    jsonb_build_object('question', 'Is there analytics or lead capture?', 'answer', 'Yes. Built-in events, lead forms, and integrations are available out of the box.'),
    jsonb_build_object('question', 'Which plans include ' || cs.subcategory || '?', 'answer', 'All plans can enable this subcategory. Higher tiers unlock volume and advanced options.')
  )
)
WHERE (cs.faq IS NULL OR jsonb_array_length(cs.faq) < 5) AND cs.status = 'active';

-- Seed example images if empty (placeholder URLs)
UPDATE public.categories_subcategories AS cs
SET sample_images = (
  jsonb_build_array(
    jsonb_build_object('url', '/public/example.png', 'alt', cs.subcategory || ' example 1'),
    jsonb_build_object('url', '/public/example1.png', 'alt', cs.subcategory || ' example 2'),
    jsonb_build_object('url', '/public/example2.png', 'alt', cs.subcategory || ' example 3')
  )
)
WHERE (cs.sample_images IS NULL OR jsonb_array_length(cs.sample_images) = 0) AND cs.status = 'active';

COMMIT;

