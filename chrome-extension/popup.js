document.getElementById("save").addEventListener("click", async () => {
  const apiUrl = document.getElementById("apiUrl").value.replace(/\/$/, "");
  const apiKey = document.getElementById("apiKey").value;

  await chrome.storage.sync.set({ apiUrl, apiKey });

  document.getElementById("status").textContent = "Configuration sauvegardée!";
  setTimeout(() => {
    document.getElementById("status").textContent = "";
  }, 2000);
});

chrome.storage.sync.get(["apiUrl", "apiKey"], (config) => {
  if (config.apiUrl) document.getElementById("apiUrl").value = config.apiUrl;
  if (config.apiKey) document.getElementById("apiKey").value = config.apiKey;
});
