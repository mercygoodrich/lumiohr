// Lumio HR — DeepL Translation Function
// Powered by DeepL API — the world's most accurate translation engine
// Used by professional translators, law firms and global enterprises
//
// Setup: Add DEEPL_API_KEY to Netlify Environment Variables
// Get your free key at: https://www.deepl.com/pro#developer
// Free tier: 500,000 characters/month — more than enough for Lumio

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { texts, target_lang } = JSON.parse(event.body);

    if (!texts || !Array.isArray(texts) || !target_lang) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'texts array and target_lang required' })
      };
    }

    if (!process.env.DEEPL_API_KEY) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ error: 'DeepL API key not configured. Add DEEPL_API_KEY to Netlify environment variables.' })
      };
    }

    // DeepL API — free tier uses api-free.deepl.com, paid uses api.deepl.com
    const isFreeTier = process.env.DEEPL_API_KEY.endsWith(':fx');
    const apiUrl = isFreeTier
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';

    // Build request body — send all texts in one call for efficiency
    const params = new URLSearchParams();
    texts.forEach(text => params.append('text', text));
    params.append('target_lang', target_lang);
    params.append('source_lang', 'EN');
    params.append('tag_handling', 'html'); // Preserves HTML tags in translation
    params.append('split_sentences', '1');
    params.append('preserve_formatting', '1');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepL API error:', response.status, errorText);

      if (response.status === 403) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Invalid DeepL API key. Check your DEEPL_API_KEY in Netlify.' })
        };
      }
      if (response.status === 456) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({ error: 'DeepL character limit reached. Upgrade at deepl.com.' })
        };
      }

      throw new Error(`DeepL API returned ${response.status}`);
    }

    const data = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ translations: data.translations })
    };

  } catch (err) {
    console.error('Translation function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Translation unavailable. Please try again.' })
    };
  }
};
