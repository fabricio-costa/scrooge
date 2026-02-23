import React, { useState, useEffect } from "react";

interface ApiClientProps {
  baseUrl: string;
  token?: string;
}

interface ApiResponse<T> {
  data: T;
  status: number;
}

export const ApiClient: React.FC<ApiClientProps> = ({ baseUrl, token }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [baseUrl]);

  async function fetchData<T>(path: string): Promise<ApiResponse<T>> {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      return { data, status: res.status };
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="error">{error}</div>;
  return <div className="api-client">Ready</div>;
};

export default ApiClient;
