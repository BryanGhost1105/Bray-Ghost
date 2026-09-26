const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY or AI_API_KEY is required.');
}

async function testGeminiOpenAI() {
  console.log("Testing Gemini via OpenAI compatibility endpoint...");
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a helpful cold email generator. Return strict JSON." },
          { role: "user", content: "Say hello and return JSON {\"status\": \"ok\"}" }
        ]
      })
    });
    console.log("OpenAI endpoint status:", res.status);
    const text = await res.text();
    console.log("OpenAI endpoint response:", text.substring(0, 300));
  } catch (err) {
    console.error("OpenAI endpoint error:", err);
  }

  console.log("\nTesting Gemini native REST endpoint...");
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: "Respond in JSON: {\"status\": \"ok\"}" }]
        }]
      })
    });
    console.log("Native endpoint status:", res.status);
    const text = await res.text();
    console.log("Native endpoint response:", text.substring(0, 300));
  } catch (err) {
    console.error("Native endpoint error:", err);
  }
}

testGeminiOpenAI();
