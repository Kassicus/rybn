"use client";

import { useState } from "react";
import {
  Code,
  Play,
  Copy,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { API_ENDPOINTS, API_CATEGORIES, type ApiEndpoint } from "@/lib/api/endpoints";

function MethodBadge({ method }: { method: string }) {
  const colors = {
    GET: "bg-blue-100 text-blue-700",
    POST: "bg-green-100 text-green-700",
    PUT: "bg-orange-100 text-orange-700",
    DELETE: "bg-red-100 text-red-700",
    PATCH: "bg-purple-100 text-purple-700",
  };

  return (
    <span
      className={`px-2 py-1 rounded text-xs font-semibold ${
        colors[method as keyof typeof colors] || "bg-gray-100 text-gray-700"
      }`}
    >
      {method}
    </span>
  );
}

function EndpointTester({ endpoint }: { endpoint: ApiEndpoint }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [bodyJson, setBodyJson] = useState(
    endpoint.exampleRequest ? JSON.stringify(endpoint.exampleRequest, null, 2) : "{}"
  );
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<Record<string, string>>({});

  const handleTest = async () => {
    setLoading(true);
    setResult(null);

    try {
      // Build URL with query params
      let url = endpoint.path;
      const params = new URLSearchParams();
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      // Build request options
      const options: RequestInit = {
        method: endpoint.method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      };

      // Add body for non-GET requests
      if (endpoint.method !== "GET" && bodyJson) {
        try {
          JSON.parse(bodyJson); // Validate JSON
          options.body = bodyJson;
        } catch (e) {
          setResult({
            error: "Invalid JSON in request body",
            details: e instanceof Error ? e.message : "Unknown error",
          });
          setLoading(false);
          return;
        }
      }

      // Make request
      const response = await fetch(url, options);
      const data = await response.json();

      setResult({
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        data,
      });
    } catch (error) {
      setResult({
        error: "Network error",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
    const queryString = params.toString() ? `?${params.toString()}` : "";

    const curlCommand = `curl -X ${endpoint.method} '${window.location.origin}${endpoint.path}${queryString}' \\
  -H 'Content-Type: application/json'${
    endpoint.method !== "GET" && bodyJson
      ? ` \\
  -d '${bodyJson}'`
      : ""
  }`;

    navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-light-border rounded-xl overflow-hidden bg-light-background">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3 hover:bg-light-background-hover transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-5 h-5 text-light-text-secondary" />
        ) : (
          <ChevronRight className="w-5 h-5 text-light-text-secondary" />
        )}
        <MethodBadge method={endpoint.method} />
        <code className="flex-1 text-left font-mono text-sm">{endpoint.path}</code>
        {endpoint.requiresAuth && (
          <span className="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-700">
            Auth Required
          </span>
        )}
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-light-border p-4 space-y-4">
          {/* Description */}
          <div>
            <Text variant="secondary">{endpoint.description}</Text>
          </div>

          {/* Notes */}
          {endpoint.notes && endpoint.notes.length > 0 && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  {endpoint.notes.map((note, i) => (
                    <Text key={i} size="sm" className="text-blue-800">
                      {note}
                    </Text>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Query Parameters */}
          {endpoint.queryParams && endpoint.queryParams.length > 0 && (
            <div>
              <Heading level="h4" className="mb-2">
                Query Parameters
              </Heading>
              <div className="space-y-2">
                {endpoint.queryParams.map((param) => (
                  <div key={param.name}>
                    <label className="block text-sm font-medium text-light-text mb-1">
                      {param.name}
                      {param.required && <span className="text-error ml-1">*</span>}
                      <span className="text-light-text-secondary font-normal ml-2">
                        ({param.type})
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder={param.example || param.description}
                      value={queryParams[param.name] || ""}
                      onChange={(e) =>
                        setQueryParams({ ...queryParams, [param.name]: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-light-border bg-white text-sm"
                    />
                    <Text size="sm" variant="secondary" className="mt-1">
                      {param.description}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Headers */}
          {endpoint.headers && endpoint.headers.length > 0 && (
            <div>
              <Heading level="h4" className="mb-2">
                Headers
              </Heading>
              <div className="space-y-2">
                {endpoint.headers.map((header) => (
                  <div key={header.name}>
                    <label className="block text-sm font-medium text-light-text mb-1">
                      {header.name}
                      {header.required && <span className="text-error ml-1">*</span>}
                    </label>
                    <input
                      type="text"
                      placeholder={header.example || header.description}
                      value={headers[header.name] || ""}
                      onChange={(e) =>
                        setHeaders({ ...headers, [header.name]: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-light-border bg-white text-sm font-mono"
                    />
                    <Text size="sm" variant="secondary" className="mt-1">
                      {header.description}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Body Parameters */}
          {endpoint.bodyParams && endpoint.bodyParams.length > 0 && (
            <div>
              <Heading level="h4" className="mb-2">
                Request Body (JSON)
              </Heading>
              <div className="space-y-2 mb-3">
                {endpoint.bodyParams.map((param) => (
                  <div
                    key={param.name}
                    className="flex items-start gap-2 text-sm p-2 bg-gray-50 rounded"
                  >
                    <Code className="w-4 h-4 text-light-text-secondary flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-mono font-semibold">{param.name}</span>
                      {param.required && <span className="text-error ml-1">*</span>}
                      <span className="text-light-text-secondary ml-2">({param.type})</span>
                      <Text size="sm" variant="secondary">
                        {param.description}
                      </Text>
                    </div>
                  </div>
                ))}
              </div>
              <textarea
                value={bodyJson}
                onChange={(e) => setBodyJson(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 rounded-lg border border-light-border bg-white font-mono text-sm"
                placeholder='{"key": "value"}'
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button onClick={handleTest} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Test Endpoint
                </>
              )}
            </Button>
            <Button onClick={handleCopyCode} variant="secondary">
              {copied ? (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy as cURL
                </>
              )}
            </Button>
          </div>

          {/* Example Response */}
          {endpoint.exampleResponse && !result && (
            <div>
              <Heading level="h4" className="mb-2">
                Example Response
              </Heading>
              <pre className="p-3 rounded-lg bg-gray-900 text-green-400 text-xs overflow-x-auto">
                {JSON.stringify(endpoint.exampleResponse, null, 2)}
              </pre>
            </div>
          )}

          {/* Actual Response */}
          {result && (
            <div>
              <Heading level="h4" className="mb-2 flex items-center gap-2">
                Response
                {result.ok ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
              </Heading>
              <div className="space-y-2">
                <div className="flex gap-2 items-center">
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      result.ok
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {result.status} {result.statusText}
                  </span>
                </div>
                <pre className="p-3 rounded-lg bg-gray-900 text-green-400 text-xs overflow-x-auto">
                  {JSON.stringify(result.data || result, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApiExplorerPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredEndpoints = selectedCategory
    ? API_ENDPOINTS.filter((e) => e.category === selectedCategory)
    : API_ENDPOINTS;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <Heading level="h2" className="flex items-center gap-3">
          <Code className="w-8 h-8 text-primary" />
          API Explorer
        </Heading>
        <Text variant="secondary">
          Test and explore all API endpoints in your application. Similar to Swagger/OpenAPI
          documentation.
        </Text>
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            selectedCategory === null
              ? "bg-primary text-white"
              : "bg-light-background hover:bg-light-background-hover"
          }`}
        >
          All ({API_ENDPOINTS.length})
        </button>
        {API_CATEGORIES.map((category) => {
          const count = API_ENDPOINTS.filter((e) => e.category === category).length;
          return (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedCategory === category
                  ? "bg-primary text-white"
                  : "bg-light-background hover:bg-light-background-hover"
              }`}
            >
              {category} ({count})
            </button>
          );
        })}
      </div>

      {/* Info Box */}
      <div className="p-4 rounded-xl border border-blue-200 bg-blue-50">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <Text className="text-blue-900 font-semibold mb-1">
              Testing Tips
            </Text>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Endpoints marked &quot;Auth Required&quot; need you to be logged in</li>
              <li>• Use the &quot;Copy as cURL&quot; button to get command-line examples</li>
              <li>• Expand each endpoint to see parameters and test it</li>
              <li>• Check example responses to understand the expected format</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Endpoints */}
      <div className="space-y-4">
        <Heading level="h3">
          {selectedCategory ? `${selectedCategory} Endpoints` : "All Endpoints"}
        </Heading>
        <div className="space-y-3">
          {filteredEndpoints.map((endpoint, index) => (
            <EndpointTester key={`${endpoint.path}-${endpoint.method}-${index}`} endpoint={endpoint} />
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="p-6 rounded-xl border border-light-border bg-light-background">
        <Heading level="h4" className="mb-4">
          API Statistics
        </Heading>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Text variant="secondary" size="sm">
              Total Endpoints
            </Text>
            <Heading level="h3" className="text-primary">
              {API_ENDPOINTS.length}
            </Heading>
          </div>
          <div>
            <Text variant="secondary" size="sm">
              Categories
            </Text>
            <Heading level="h3" className="text-primary">
              {API_CATEGORIES.length}
            </Heading>
          </div>
          <div>
            <Text variant="secondary" size="sm">
              GET Endpoints
            </Text>
            <Heading level="h3" className="text-primary">
              {API_ENDPOINTS.filter((e) => e.method === "GET").length}
            </Heading>
          </div>
          <div>
            <Text variant="secondary" size="sm">
              POST Endpoints
            </Text>
            <Heading level="h3" className="text-primary">
              {API_ENDPOINTS.filter((e) => e.method === "POST").length}
            </Heading>
          </div>
        </div>
      </div>
    </div>
  );
}
