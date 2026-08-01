const BASE = '/api';

export async function validateTemplate(file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${BASE}/validate`, { method: 'POST', body: formData });
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    throw new Error((body && body.error) || `Validation failed with status ${res.status}`);
  }
  return body;
}
