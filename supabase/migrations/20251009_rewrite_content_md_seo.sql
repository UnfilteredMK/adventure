BEGIN;

-- Rewrite content_md with industry-tailored, SEO-rich HTML for all active subcategories
UPDATE public.categories_subcategories AS cs
SET content_md = (
  '<h2>' || cs.subcategory || ' – AI Image Generation & Visualization</h2>' ||
  '<p>Adventure provides an AI‑powered, white‑label image generation widget that lets your customers preview ' || lower(cs.subcategory) || ' before they commit. Perfect for ' || coalesce(cs.category_name,'your industry') || 
  ', this tool increases engagement, captures qualified leads, and shortens decision cycles.</p>' ||

  '<h3>Who benefits</h3>' ||
  '<ul>' ||
    '<li>Contractors and service providers offering ' || lower(cs.subcategory) || '</li>' ||
    '<li>Designers and consultants needing fast visual mockups</li>' ||
    '<li>Retailers and e‑commerce brands showcasing variations</li>' ||
  '</ul>' ||

  '<h3>Why it ranks and converts</h3>' ||
  '<p>SEO‑friendly, fast to load, and aligned with high‑intent keywords like "' || lower(cs.subcategory) || ' preview", "AI ' || lower(cs.subcategory) || '", and "before and after ' || lower(cs.subcategory) || '". The widget keeps visitors on‑page longer and turns curiosity into measurable leads.</p>' ||

  '<h3>How it works</h3>' ||
  '<ol>' ||
    '<li>Embed a lightweight, white‑label widget on your site</li>' ||
    '<li>Visitors upload a photo or select a template</li>' ||
    '<li>AI generates on‑brand previews for ' || lower(cs.subcategory) || '</li>' ||
    '<li>Export before/after, share results, or submit a lead</li>' ||
  '</ol>' ||

  '<h3>Why ' || cs.subcategory || ' with AI</h3>' ||
  '<ul>' ||
    '<li>Reduce returns and no‑shows by aligning expectations</li>' ||
    '<li>Boost conversions with realistic visual proof</li>' ||
    '<li>Capture emails and inquiries at the perfect moment</li>' ||
  '</ul>' ||

  '<h3>Built for ' || coalesce(cs.category_name,'your industry') || '</h3>' ||
  '<p>From prompts to branding, everything is customizable for ' || lower(coalesce(cs.category_name,'your industry')) || '. Add your logo, color system, guardrails, and data capture workflow.</p>'
)
WHERE cs.status = 'active';

COMMIT;

