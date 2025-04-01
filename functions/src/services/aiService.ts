// Service for interacting with OpenAI (if needed for NLP commands)
const OpenAI = require("openai");
const { defineString } = require("firebase-functions/params");

// Params
const openaiApiKey = defineString("OPENAI_API_KEY");

const openai = new OpenAI({
  apiKey: openaiApiKey.value(),
});

// TODO: Define function schemas, system prompt etc.
// Adapt the logic from the old index.js

async function interpretUserRequest(text, context = []) {
  // Placeholder - adapt OpenAI call from old index.js
  console.log("Interpreting user request (AI):", text);
  // const completion = await openai.chat.completions.create({ ... });
  // return completion.choices[0].message;
  return { content: "AI processing not fully implemented yet." };
}

module.exports = {
  interpretUserRequest,
  // ... other AI related functions
}; 