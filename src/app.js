import { API_BASE } from './config';

async function request(endpoint, options = {}) {
  const headers = { ...options.headers };
  
  // Set Content-Type to JSON if body is a plain object/string and not FormData
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // Attach mandatory custom header for all mutating requests (POST, PUT, DELETE)
  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['X-Requested-With'] = 'portfolio';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    method,
    headers,
    credentials: 'include', // Crucial for cross-domain mobile cookies (Vercel -> Render)
  });

  if (response.status === 401) {
    window.dispatchEvent(new Event('session-expired'));
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Something went wrong on the server.');
  }

  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  // ---------- Public ----------
  getPublic: () => request('/public'),

  // ---------- Auth ----------
  me: () => request('/admin/me'),
  
  login: (username, password) =>
    request('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    request('/admin/logout', {
      method: 'POST',
    }),

  // ---------- Admin Data & Actions ----------
  getAdminData: () => request('/admin/data'),

  updateProfile: (formData) =>
    request('/admin/profile', {
      method: 'PUT',
      body: formData, // FormData automatically sets multipart/form-data headers
    }),

  createProject: (formData) =>
    request('/admin/projects', {
      method: 'POST',
      body: formData,
    }),

  updateProject: (id, formData) =>
    request(`/admin/projects/${id}`, {
      method: 'PUT',
      body: formData,
    }),

  deleteProject: (id) =>
    request(`/admin/projects/${id}`, {
      method: 'DELETE',
    }),
};