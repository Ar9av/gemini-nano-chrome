// Paste into the DevTools console. Constrains the model's output to a JSON Schema
// via responseConstraint, so you get parseable JSON back instead of free-form text.

const session = await LanguageModel.create({
  initialPrompts: [
    { role: "system", content: "You are a terse assistant that only outputs valid JSON." },
  ],
});

const schema = {
  type: "object",
  properties: {
    sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
    confidence: { type: "number" },
  },
  required: ["sentiment", "confidence"],
};

const result = await session.prompt(
  'Classify the sentiment of: "This new on-device AI is shockingly fast and works offline."',
  { responseConstraint: schema }
);

console.log(JSON.parse(result));
// { sentiment: "positive", confidence: 0.95 }

console.log("context used:", session.contextUsage, "/", session.contextWindow);

session.destroy();
