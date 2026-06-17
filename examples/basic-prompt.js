// Paste into the DevTools console of any page (chrome://flags must be set first, see README).

const availability = await LanguageModel.availability();
console.log("availability:", availability); // "unavailable" | "downloadable" | "downloading" | "available"

// create() is what triggers the model download the first time you call it.
// availability() alone does not start or advance the download.
const session = await LanguageModel.create({
  monitor(m) {
    m.addEventListener("downloadprogress", (e) => {
      console.log(`downloading: ${(e.loaded * 100).toFixed(1)}%`);
    });
  },
});

const answer = await session.prompt("What are you, in one sentence?");
console.log(answer);

session.destroy();
