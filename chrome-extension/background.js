chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CAPTURE_PRODUCT") {
    captureProduct(message.payload).then(sendResponse);
    return true;
  }
});

async function captureProduct(payload) {
  const config = await chrome.storage.sync.get(["apiUrl", "apiKey"]);

  const apiUrl = config.apiUrl || "http://localhost:3000";
  const apiKey = config.apiKey;

  if (!apiKey) {
    return { success: false, error: "Clé API non configurée. Ouvrez le popup de l'extension." };
  }

  try {
    const response = await fetch(`${apiUrl}/api/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (response.status === 409) {
      return { success: false, duplicate: true, productId: data.productId };
    }

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error || `HTTP ${response.status}`,
      };
    }

    return {
      success: true,
      productId: data.productId,
      dashboardUrl: data.dashboardUrl,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
