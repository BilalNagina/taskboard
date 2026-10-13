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
  if (!res.ok) throw new ApiError(capitalise(data.error ?? `Request failed (${res.status})`), res.status);
  return data;
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const api = {
  // account
  me: () => request('/auth/me'),
  register: (body) => request('/auth/register', { method: 'POST', json: body }),
  login: (body) => request('/auth/login', { method: 'POST', json: body }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', json: { email } }),
  resetPassword: (token, password) => request('/auth/reset-password', { method: 'POST', json: { token, password } }),
  updateProfile: (changes) => request('/me', { method: 'PATCH', json: changes }),
  changePassword: (currentPassword, newPassword) =>
    request('/me/password', { method: 'POST', json: { currentPassword, newPassword } }),

  // workspaces and boards
  workspaces: () => request('/workspaces'),
  createWorkspace: (name) => request('/workspaces', { method: 'POST', json: { name } }),
  renameWorkspace: (id, name) => request(`/workspaces/${id}`, { method: 'PATCH', json: { name } }),
  boards: (workspaceId) => request(`/workspaces/${workspaceId}/boards`),
  createBoard: (workspaceId, name) => request(`/workspaces/${workspaceId}/boards`, { method: 'POST', json: { name } }),
  board: (id) => request(`/boards/${id}`),
  renameBoard: (id, name) => request(`/boards/${id}`, { method: 'PATCH', json: { name } }),
  deleteBoard: (id) => request(`/boards/${id}`, { method: 'DELETE' }),

  // tasks and files
  tasks: (boardId) => request(`/boards/${boardId}/tasks`),
  createTask: (boardId, task) => request(`/boards/${boardId}/tasks`, { method: 'POST', json: task }),
  updateTask: (id, changes) => request(`/tasks/${id}`, { method: 'PATCH', json: changes }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  upload: (taskId, file) => request(`/tasks/${taskId}/attachments`, { method: 'POST', file }),
  deleteAttachment: (id) => request(`/attachments/${id}`, { method: 'DELETE' }),
  downloadUrl: (id) => `/api/attachments/${id}`,
};
