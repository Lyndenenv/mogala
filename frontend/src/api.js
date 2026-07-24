const API = 'https://173.249.4.136';

export const request = async (path, options = {}) => {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (res.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/mogala/';
      return { error: 'Session expired' };
    }

    const text = await res.text();
    if (!text) return res.ok ? {} : { error: `Request failed (${res.status})` };

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { error: res.ok ? 'Unexpected server response' : `Server error (${res.status})` };
    }

    if (!res.ok && !data.error) {
      return { error: data.message || `Request failed (${res.status})` };
    }
    return data;
  } catch {
    return { error: 'Network error — check your connection' };
  }
};
