import React, { useMemo } from 'react';
import { Compass, ShieldAlert, Activity } from 'lucide-react';
import { createDropoutPlugin } from '../utils/dropoutPlugin';
import ZoomableLine from './ZoomableLine';

export default function ImuMotion({ data, boardDropouts, startTs }) {
  // Downsample data for visualization performance
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const valid = data.filter(row => !isNaN(parseFloat(row.ts)));
    
    // Increased targetPoints to 4000 to preserve full high-frequency dropouts/details
    const targetPoints = 4000;
    if (valid.length <= targetPoints) return valid;
    
    const step = Math.ceil(valid.length / targetPoints);
    return valid.filter((_, idx) => idx % step === 0);
  }, [data]);


  // Chart configuration helpers
  const getChartOptions = (yTitle, xTitle = 'Time (s)') => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#e2e8f0',
          font: { family: 'Inter', size: 11, weight: 500 }
        }
      },
      zoom: {
        pan: { enabled: true, mode: 'x' },
        zoom: {
          wheel: { enabled: false },
          pinch: { enabled: true },
          mode: 'x',
        }
      },
      tooltip: {
        mode: 'nearest',
        intersect: false,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 10,
        bodyFont: { family: 'var(--font-mono)', size: 12 }
      }
    },
    scales: {
      x: {
        type: 'linear',
        title: {
          display: true,
          text: xTitle,
          color: '#94a3b8',
          font: { family: 'Inter', size: 12 }
        },
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#64748b', maxTicksLimit: 10 }
      },
      y: {
        title: {
          display: true,
          text: yTitle,
          color: '#94a3b8',
          font: { family: 'Inter', size: 12 }
        },
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#64748b', maxTicksLimit: 8 }
      }
    }
  });

  // Helper to parse a field to continuous linear datasets
  const parseLinearData = (colName, scale = 1.0) => {
    return processedData.map(row => {
      const val = parseFloat(row[colName]);
      const time = parseFloat((parseFloat(row.ts) - startTs).toFixed(2));
      return { x: time, y: isNaN(val) ? null : val * scale };
    });
  };

  // Dropout highlighter plugin
  const imuPlugin = useMemo(() => createDropoutPlugin(boardDropouts?.imu, startTs), [boardDropouts, startTs]);

  // 1. Primary IMU G-forces
  const gForceChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Longitudinal Gs (ax)',
          data: parseLinearData('imu.ax', 1.0 / 9.80665),
          borderColor: '#ef4444', // Red
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Lateral Gs (ay)',
          data: parseLinearData('imu.ay', 1.0 / 9.80665),
          borderColor: '#3b82f6', // Blue
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Vertical Gs (az)',
          data: parseLinearData('imu.az', 1.0 / 9.80665),
          borderColor: '#10b981', // Green
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 2. Longitudinal G comparison across 3 sensors (twist/pitch analysis)
  const axComparisonChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Front/GPS IMU (ax)',
          data: parseLinearData('imu[0].ax', 1.0 / 9.80665), // scaled to Gs
          borderColor: '#f97316', // Orange
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Mid IMU (ax)',
          data: parseLinearData('imu[1].ax'), // already in Gs
          borderColor: '#06b6d4', // Cyan
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Rear IMU (ax)',
          data: parseLinearData('imu[2].ax'), // already in Gs
          borderColor: '#8b5cf6', // Purple
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 3. Lateral G comparison across 3 sensors (chassis yaw/flex analysis)
  const ayComparisonChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Front/GPS IMU (ay)',
          data: parseLinearData('imu[0].ay', 1.0 / 9.80665), // scaled to Gs
          borderColor: '#f97316',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Mid IMU (ay)',
          data: parseLinearData('imu[1].ay'), // already in Gs
          borderColor: '#06b6d4',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Rear IMU (ay)',
          data: parseLinearData('imu[2].ay'), // already in Gs
          borderColor: '#8b5cf6',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 4. Angular Rates (Roll, Pitch, Yaw)
  const gyroChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Roll Rate',
          data: parseLinearData('imu.roll'),
          borderColor: '#eab308', // Yellow
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Pitch Rate',
          data: parseLinearData('imu.pitch'),
          borderColor: '#ec4899', // Pink
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Yaw Rate',
          data: parseLinearData('imu.yaw'),
          borderColor: '#6366f1', // Indigo
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  return (
    <div className="animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      <div className="grid-cols-2">
        {/* Primary G-Forces */}
        <div className="glass-panel">
          <h2 className="section-title">Chassis G-Forces (Primary IMU)</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Plots acceleration forces in Gs along the longitudinal (accel/braking), lateral (cornering), and vertical directions.
          </p>
          <div className="chart-container">
            <ZoomableLine options={getChartOptions('Chassis Forces (G)')} data={gForceChartData} plugins={[imuPlugin]} />
          </div>
        </div>

        {/* Angular rates */}
        <div className="glass-panel">
          <h2 className="section-title">Angular Rotational Rates</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Roll, pitch, and yaw rates in degrees/sec. Helpful for monitoring body roll transition speed and turn-in response.
          </p>
          <div className="chart-container">
            <ZoomableLine options={getChartOptions('Angular Speed (deg/s)')} data={gyroChartData} plugins={[imuPlugin]} />
          </div>
        </div>
      </div>

      <div className="grid-cols-2">
        {/* Longitudinal G comparison */}
        <div className="glass-panel">
          <h2 className="section-title">Longitudinal Gs Comparison</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Compares acceleration forces across the Front (GPS), Mid, and Rear IMUs to study chassis flex and pitching dynamics.
          </p>
          <div className="chart-container">
            <ZoomableLine options={getChartOptions('Acceleration (G)')} data={axComparisonChartData} plugins={[imuPlugin]} />
          </div>
        </div>

        {/* Lateral G comparison */}
        <div className="glass-panel">
          <h2 className="section-title">Lateral Gs Comparison</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Compares cornering forces across Front, Mid, and Rear sensor locations. Deviations indicate vehicle yaw or frame twisting.
          </p>
          <div className="chart-container">
            <ZoomableLine options={getChartOptions('Acceleration (G)')} data={ayComparisonChartData} plugins={[imuPlugin]} />
          </div>
        </div>
      </div>

    </div>
  );
}
