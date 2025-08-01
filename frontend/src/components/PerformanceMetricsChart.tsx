import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, TrendingUp, Activity, Zap, Wifi, Shield } from 'lucide-react';
import { apiCall } from "@/lib/api";

interface PerformanceMetricsChartProps {
  connectionId: number;
  connectionName: string;
  showIcons?: boolean;
  showGrade?: boolean;
}

interface MetricData {
  id: number;
  connection_id: number;
  hostname: string;
  port: number;
  check_type: string;
  dns_resolve_time: number | null;
  tcp_connect_time: number | null;
  tls_handshake_time: number | null;
  certificate_processing_time: number | null;
  total_time: number | null;
  key_algorithm: string | null;
  key_size: number | null;
  signature_algorithm: string | null;
  certificate_valid: boolean;
  days_until_expiry: number;
  error_message: string | null;
  checked_at: string;
}

interface AverageMetrics {
  avg_dns_resolve_time: number;
  avg_tcp_connect_time: number;
  avg_tls_handshake_time: number;
  avg_certificate_processing_time: number;
  avg_total_time: number;
  check_count: number;
}

interface TimelineDataPoint {
  timestamp: string;
  fullTimestamp: string;
  dnsResolve: number;
  tcpConnect: number;
  tlsHandshake: number;
  certProcessing: number;
  totalTime: number;
}

interface AverageDataPoint {
  name: string;
  time: number;
  color: string;
}

const PerformanceMetricsChart: React.FC<PerformanceMetricsChartProps> = ({ connectionId, connectionName }) => {
  const [metrics, setMetrics] = useState<MetricData[]>([]);
  const [averageMetrics, setAverageMetrics] = useState<AverageMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<string>('24');
  const [viewType, setViewType] = useState<'timeline' | 'average'>('timeline');

  const fetchMetrics = async () => {
    if (!connectionId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiCall(`/data/${connectionId}/metrics?hours=${timeRange}&limit=100`);
      if (response.ok) {
        const data = await response.json();
        setMetrics(data.metrics || []);
        setAverageMetrics(data.averageMetrics);
      } else {
        throw new Error('Failed to fetch metrics');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [connectionId, timeRange]);


  const formatTimestampWithSeconds = (timestamp: string) => {
    // Handle both UTC and local timestamps
    let date: Date;
    
    // If timestamp ends with 'Z' or has timezone info, it's already UTC
    if (timestamp.endsWith('Z') || timestamp.includes('+') || timestamp.includes('T')) {
      date = new Date(timestamp);
    } else {
      // If it's a plain datetime string, assume it's UTC and convert
      date = new Date(timestamp + ' UTC');
    }
    
    // Format in user's local timezone
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', 
      day: 'numeric',
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).format(date);
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) {
      // Round to whole milliseconds for values under 1 second
      return `${Math.round(ms)}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Aggregate data to reduce chart clutter - group by time intervals
  const aggregateData = (data: MetricData[], maxPoints: number = 20): TimelineDataPoint[] => {
    if (data.length <= maxPoints) {
      // If we have few data points, show them all
      return data.map((metric) => ({
        timestamp: formatTimestampWithSeconds(metric.checked_at),
        fullTimestamp: metric.checked_at,
        dnsResolve: metric.dns_resolve_time || 0,
        tcpConnect: metric.tcp_connect_time || 0,
        tlsHandshake: metric.tls_handshake_time || 0,
        certProcessing: metric.certificate_processing_time || 0,
        totalTime: metric.total_time || 0
      })).sort((a, b) => new Date(a.fullTimestamp).getTime() - new Date(b.fullTimestamp).getTime());
    }

    // Group data into time buckets for aggregation
    const sortedData = [...data].sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());
    const bucketSize = Math.ceil(sortedData.length / maxPoints);
    const aggregated: TimelineDataPoint[] = [];

    for (let i = 0; i < sortedData.length; i += bucketSize) {
      const bucket = sortedData.slice(i, i + bucketSize);
      const bucketAverage = {
        timestamp: formatTimestampWithSeconds(bucket[Math.floor(bucket.length / 2)].checked_at), // Use middle timestamp
        fullTimestamp: bucket[Math.floor(bucket.length / 2)].checked_at,
        dnsResolve: Math.round(bucket.reduce((sum, m) => sum + (m.dns_resolve_time || 0), 0) / bucket.length),
        tcpConnect: Math.round(bucket.reduce((sum, m) => sum + (m.tcp_connect_time || 0), 0) / bucket.length),
        tlsHandshake: Math.round(bucket.reduce((sum, m) => sum + (m.tls_handshake_time || 0), 0) / bucket.length),
        certProcessing: Math.round(bucket.reduce((sum, m) => sum + (m.certificate_processing_time || 0), 0) / bucket.length),
        totalTime: Math.round(bucket.reduce((sum, m) => sum + (m.total_time || 0), 0) / bucket.length)
      };
      aggregated.push(bucketAverage);
    }

    return aggregated;
  };

  // Prepare data for timeline chart with aggregation
  const timelineData: TimelineDataPoint[] = aggregateData(metrics, 15); // Limit to 15 points max

  // Prepare data for average comparison chart
  const averageData: AverageDataPoint[] = averageMetrics ? [
    { name: 'DNS Resolve', time: averageMetrics.avg_dns_resolve_time || 0, color: '#8884d8' },
    { name: 'TCP Connect', time: averageMetrics.avg_tcp_connect_time || 0, color: '#82ca9d' },
    { name: 'TLS Handshake', time: averageMetrics.avg_tls_handshake_time || 0, color: '#ffc658' },
    { name: 'Cert Processing', time: averageMetrics.avg_certificate_processing_time || 0, color: '#ff7300' }
  ] : [];

  // Calculate performance grade based on total time
  const getPerformanceGrade = (totalTime: number) => {
    if (totalTime <= 500) return { grade: 'A+', color: 'text-green-600' };
    if (totalTime <= 1000) return { grade: 'A', color: 'text-green-500' };
    if (totalTime <= 2000) return { grade: 'B', color: 'text-yellow-500' };
    if (totalTime <= 3000) return { grade: 'C', color: 'text-orange-500' };
    return { grade: 'D', color: 'text-red-500' };
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Activity className="w-5 h-5 mr-2" />
            Performance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Clock className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-500" />
              <p className="text-muted-foreground">Loading performance data...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Activity className="w-5 h-5 mr-2" />
            Performance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-red-600 mb-4">Error loading metrics: {error}</p>
            <Button onClick={fetchMetrics} variant="outline">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (metrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Activity className="w-5 h-5 mr-2" />
            Performance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground">No performance data available for this connection.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center">
              <Activity className="w-5 h-5 mr-2" />
              Performance Metrics
            </CardTitle>
            <CardDescription>
              Connection performance data for {connectionName}
            </CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Select value={viewType} onValueChange={(value) => setViewType(value as 'timeline' | 'average')}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="timeline">Timeline</SelectItem>
                <SelectItem value="average">Average</SelectItem>
              </SelectContent>
            </Select>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1h</SelectItem>
                <SelectItem value="6">6h</SelectItem>
                <SelectItem value="24">24h</SelectItem>
                <SelectItem value="168">7d</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Current Performance Summary */}
        {averageMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <div className="flex items-center justify-center mb-2">
                <Wifi className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-sm font-medium text-blue-600 dark:text-blue-400">DNS Resolve</div>
              <div className="text-lg font-bold text-blue-800 dark:text-blue-200">
                {formatDuration(averageMetrics.avg_dns_resolve_time || 0)}
              </div>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded-lg">
              <div className="flex items-center justify-center mb-2">
                <Activity className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-sm font-medium text-green-600 dark:text-green-400">TCP Connect</div>
              <div className="text-lg font-bold text-green-800 dark:text-green-200">
                {formatDuration(averageMetrics.avg_tcp_connect_time || 0)}
              </div>
            </div>
            <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
              <div className="flex items-center justify-center mb-2">
                <Shield className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div className="text-sm font-medium text-yellow-600 dark:text-yellow-400">TLS Handshake</div>
              <div className="text-lg font-bold text-yellow-800 dark:text-yellow-200">
                {formatDuration(averageMetrics.avg_tls_handshake_time || 0)}
              </div>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
              <div className="flex items-center justify-center mb-2">
                <Activity className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="text-sm font-medium text-purple-600 dark:text-purple-400">Cert Processing</div>
              <div className="text-lg font-bold text-purple-800 dark:text-purple-200">
                {formatDuration(averageMetrics.avg_certificate_processing_time || 0)}
              </div>
            </div>
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-950 rounded-lg">
              <div className="flex items-center justify-center mb-2">
                <Zap className={`w-5 h-5 ${getPerformanceGrade(averageMetrics.avg_total_time || 0).color}`} />
              </div>
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400">Performance</div>
              <div className={`text-2xl font-bold ${getPerformanceGrade(averageMetrics.avg_total_time || 0).color}`}>
                {getPerformanceGrade(averageMetrics.avg_total_time || 0).grade}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {formatDuration(averageMetrics.avg_total_time || 0)}
              </div>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            {viewType === 'timeline' ? (
              <LineChart data={timelineData} margin={{ top: 20, right: 30, left: 50, bottom: 80 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis 
                  dataKey="timestamp" 
                  tick={{ fontSize: 10 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Time (ms)', angle: -90, position: 'insideLeft' }}
                  width={60}
                />
                <Tooltip 
                  labelFormatter={(value) => `${value}`}
                  formatter={(value, name) => [formatDuration(Number(value)), name]}
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #ccc',
                    borderRadius: '4px'
                  }}
                />
                <Legend 
                  wrapperStyle={{ paddingTop: '20px' }}
                  iconType="line"
                />
                <Line 
                  type="monotone" 
                  dataKey="dnsResolve" 
                  stroke="#8884d8" 
                  strokeWidth={2}
                  name="DNS Resolve"
                  connectNulls={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="tcpConnect" 
                  stroke="#82ca9d" 
                  strokeWidth={2}
                  name="TCP Connect"
                  connectNulls={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="tlsHandshake" 
                  stroke="#ffc658" 
                  strokeWidth={2}
                  name="TLS Handshake"
                  connectNulls={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="certProcessing" 
                  stroke="#ff7300" 
                  strokeWidth={2}
                  name="Cert Processing"
                  connectNulls={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="totalTime" 
                  stroke="#8dd1e1" 
                  strokeWidth={3}
                  strokeDasharray="5 5"
                  name="Total Time"
                  connectNulls={false}
                />
              </LineChart>
            ) : (
              <BarChart data={averageData} margin={{ top: 20, right: 30, left: 50, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fontSize: 11 }}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                />
                <YAxis 
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Time (ms)', angle: -90, position: 'insideLeft' }}
                  width={60}
                />
                <Tooltip 
                  formatter={(value) => [formatDuration(Number(value)), 'Average Time']}
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #ccc',
                    borderRadius: '4px'
                  }}
                />
                <Bar dataKey="time" radius={[4, 4, 0, 0]}>
                  {averageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Data Points Summary */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex flex-col">
              <span>{metrics.length} total data points over last {timeRange}h</span>
              {metrics.length > 15 && (
                <span className="text-xs">Showing {timelineData.length} aggregated points for clarity</span>
              )}
            </div>
            <Button onClick={fetchMetrics} variant="ghost" size="sm">
              <TrendingUp className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PerformanceMetricsChart;