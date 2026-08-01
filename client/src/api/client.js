const BASE = '/api';

async function handleResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (body && body.error) || `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return body;
}

export async function fetchObjects() {
  const res = await fetch(`${BASE}/objects`);
  return handleResponse(res);
}

export async function fetchObject(id) {
  const res = await fetch(`${BASE}/objects/${encodeURIComponent(id)}`);
  return handleResponse(res);
}

export async function validateFile(objectId, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE}/objects/${encodeURIComponent(objectId)}/validate`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse(res);
}
