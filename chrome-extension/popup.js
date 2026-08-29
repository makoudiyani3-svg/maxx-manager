const DEFAULT_API_URL = "https://maxx-manager.vercel.app";

document.getElementById("save").addEventListener("click", async () => {
  const apiUrl = document.getElementById("apiUrl").value.replace(/\/$/, "");
  const apiKey = document.getElementById("apiKey").value.trim();

  await chrome.storage.sync.set({ apiUrl, apiKey });

  document.getElementById("status").textContent = "Configuration sauvegardée!";
  setTimeout(() => {
    document.getElementById("status").textContent = "";
  }, 2000);
});

document.getElementById("test").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const apiUrl = (
    document.getElementById("apiUrl").value || DEFAULT_API_URL
  ).replace(/\/$/, "");
  const apiKey = document.getElementById("apiKey").value.trim();

  status.textContent = "Test en cours…";
  status.style.color = "#52525b";

  try {
    const health = await fetch(`${apiUrl}/api/health`);
    const healthData = await health.json();

    if (!health.ok) {
      status.textContent = `Serveur injoignable (${health.status})`;
      status.style.color = "#dc2626";
      return;
    }

    if (!healthData.apiKeyConfigured) {
      status.textContent =
        "Serveur OK mais MAXX_API_KEY absente sur Vercel — ajoutez-la puis redeploy";
      status.style.color = "#dc2626";
      return;
    }

    if (!apiKey) {
      status.textContent = "Entrez la clé API (même valeur que MAXX_API_KEY sur Vercel)";
      status.style.color = "#dc2626";
      return;
    }

    const probe = await fetch(`${apiUrl}/api/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        sourceUrl: "https://extension-test.invalid/probe",
        title: "probe",
      }),
    });

    const probeData = await probe.json();

    if (probe.status === 401) {
      status.textContent =
        probeData.message || "Clé API incorrecte — doit matcher MAXX_API_KEY Vercel";
      status.style.color = "#dc2626";
      return;
    }

    // 400/409 = auth OK
    if (probe.status === 400 || probe.status === 409) {
      status.textContent = "Connexion OK — clé API valide";
      status.style.color = "#059669";
      return;
    }

    status.textContent = `Réponse inattendue: ${probe.status}`;
    status.style.color = "#d97706";
  } catch (err) {
    status.textContent = `Erreur réseau: ${err.message}`;
    status.style.color = "#dc2626";
  }
});

chrome.storage.sync.get(["apiUrl", "apiKey"], (config) => {
  document.getElementById("apiUrl").value = config.apiUrl || DEFAULT_API_URL;
  if (config.apiKey) document.getElementById("apiKey").value = config.apiKey;
});
