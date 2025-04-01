import { OpenAI } from "openai";
import { defineString } from "firebase-functions/params";

// Params
const openaiApiKey = defineString("OPENAI_API_KEY");

const openai = new OpenAI({
  apiKey: openaiApiKey.value(),
});

// TODO: Define function schemas, system prompt etc.
// Adapt the logic from the old index.js

interface UserRequestResponse {
  content: string;
}

async function interpretUserRequest(text: string, context: any[] = []): Promise<UserRequestResponse> {
  // Placeholder - adapt OpenAI call from old index.js
  console.log("Interpreting user request (AI):", text);
  // const completion = await openai.chat.completions.create({ ... });
  // return completion.choices[0].message;
  return { content: "AI processing not fully implemented yet." };
}

export {
  interpretUserRequest,
  // ... other AI related functions
}; 