export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// `json` is sent as a JSON body; `file` is sent as the raw request body.
async function request(path, { method = 'GET', json, file } = {}) {
  const options = { method, headers: {} };
  if (json !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(json);
  }
  if (file) {
    options.headers['Content-Type'] = file.type || 'application/octet-stream';
    options.headers['X-Filename'] = encodeURIComponent(file.name);
    options.body = file;
  }
  const res = await fetch(`/api${path}`, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const api = {
  me: () => request('/auth/me'),
  register: (name, email, password) => request('/auth/register', { method: 'POST', json: { name, email, password } }),
  login: (email, password) => request('/auth/login', { method: 'POST', json: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  boards: () => request('/boards'),
  createBoard: (name) => request('/boards', { method: 'POST', json: { name } }),
  renameBoard: (id, name) => request(`/boards/${id}`, { method: 'PATCH', json: { name } }),
  deleteBoard: (id) => request(`/boards/${id}`, { method: 'DELETE' }),

  tasks: (boardId) => request(`/boards/${boardId}/tasks`),
  createTask: (boardId, title, dueDate) =>
    request(`/boards/${boardId}/tasks`, { method: 'POST', json: { title, dueDate: dueDate || null } }),
  updateTask: (id, changes) => request(`/tasks/${id}`, { method: 'PATCH', json: changes }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),

  // The API checks ownership and streams the file to private S3 storage.
  upload: (taskId, file) => request(`/tasks/${taskId}/attachments`, { method: 'POST', file }),
  deleteAttachment: (id) => request(`/attachments/${id}`, { method: 'DELETE' }),
  downloadUrl: (id) => `/api/attachments/${id}`,
};
