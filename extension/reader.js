/*
 * What runs inside the page.
 *
 * This is the entire reason the extension exists. `/api/import/url` fetches a
 * product page from the server and gets whatever the server is sent — which for
 * the large chains is an empty JavaScript shell with no product in it. This
 * function runs *after* that JavaScript has run, in the tab you are looking at,
 * with your session and your region and your currency, and reads the page as it
 * actually is.
 *
 * It also fetches the product image from inside the page rather than sending a
 * URL for the server to fetch. Retailer CDNs routinely refuse a request with no
 * referrer or the wrong one, and a request made here carries the page's own —
 * so an image that a server fetch gets a 403 for arrives fine.
 *
 * Passed to `chrome.scripting.executeScript` as `func`, which serialises the
 * function's source and evaluates it in the tab. That means it must be entirely
 * self-contained — it cannot close over anything in this module, and every
 * helper it needs has to be declared inside it. Exported only so the background
 * worker can name it; nothing in this file runs in the extension's own context.
 */
export async function readProductFromPage() {
  const meta = (...names) => {
    for (const name of names) {
      const element =
        document.querySelector(`meta[property="${name}"]`) ??
        document.querySelector(`meta[name="${name}"]`);
      const content = element?.getAttribute("content")?.trim();
      if (content) return content;
    }
    return null;
  };

  // JSON-LD first, same order of trust as the server-side parser: structured
  // data is what the retailer tells Google, so it's what they stand behind.
  let product = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const flatten = (node, out = []) => {
        if (Array.isArray(node)) {
          node.forEach((entry) => flatten(entry, out));
        } else if (node && typeof node === "object") {
          out.push(node);
          if (node["@graph"]) flatten(node["@graph"], out);
          if (node.mainEntity) flatten(node.mainEntity, out);
        }
        return out;
      };
      const found = flatten(JSON.parse(script.textContent)).find((node) => {
        const type = node["@type"];
        const types = Array.isArray(type) ? type : [type];
        return types.some((entry) => String(entry).toLowerCase() === "product");
      });
      if (found) {
        product = found;
        break;
      }
    } catch {
      // One malformed block shouldn't sink the read.
    }
  }

  const nameOf = (value) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return nameOf(value[0]);
    if (value && typeof value === "object") return value.name ?? null;
    return null;
  };

  const title =
    product?.name ?? meta("og:title", "twitter:title") ?? document.title ?? null;
  const brand = nameOf(product?.brand) ?? meta("og:site_name", "product:brand");

  let imageUrl = null;
  const fromProduct = product?.image;
  if (typeof fromProduct === "string") imageUrl = fromProduct;
  else if (Array.isArray(fromProduct)) {
    imageUrl = typeof fromProduct[0] === "string" ? fromProduct[0] : fromProduct[0]?.url;
  } else if (fromProduct && typeof fromProduct === "object") {
    imageUrl = fromProduct.url ?? fromProduct.contentUrl ?? null;
  }
  imageUrl = imageUrl ?? meta("og:image", "og:image:url", "twitter:image");

  // Last resort: the biggest image actually rendered. On a JS-built page with
  // no markup at all, this is often the only thing that works — and it's the
  // one the page is showing you, which is the right one.
  if (!imageUrl) {
    let best = null;
    let bestArea = 0;
    for (const image of document.images) {
      const area = image.naturalWidth * image.naturalHeight;
      if (area > bestArea && image.naturalWidth >= 400) {
        best = image.currentSrc || image.src;
        bestArea = area;
      }
    }
    imageUrl = best;
  }

  // Fetch it here, in the page, where the referrer is right.
  let imageBase64 = null;
  let contentType = null;
  if (imageUrl) {
    try {
      const response = await fetch(new URL(imageUrl, location.href).href);
      if (response.ok) {
        const blob = await response.blob();
        // 6MB of blob is well past any product photo; past that, send the URL
        // and let the server try instead of pushing megabytes through a popup.
        if (blob.size <= 6_000_000) {
          contentType = blob.type || "image/jpeg";
          imageBase64 = await new Blob([blob])
            .arrayBuffer()
            .then((buffer) => {
              let binary = "";
              const bytes = new Uint8Array(buffer);
              // Chunked: String.fromCharCode(...millionBytes) blows the stack.
              for (let index = 0; index < bytes.length; index += 8192) {
                binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
              }
              return btoa(binary);
            });
        }
      }
    } catch {
      // Cross-origin refusal, CSP, offline — the capture still has its link.
    }
  }

  return {
    sourceUrl: location.href,
    title: title ? String(title).slice(0, 200) : null,
    brand: brand ? String(brand).slice(0, 80) : null,
    imageBase64,
    contentType,
  };
}
