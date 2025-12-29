import { motion } from 'framer-motion';
import { EventClass, EVENT_CLASS_COLORS } from '../../types/explainability';
import type { EventFeatures } from '../../types/visualization';

interface ModelInspectorProps {
  features: EventFeatures;
  className: EventClass;
  confidence: number;
}

export function ModelInspector({ features, className, confidence }: ModelInspectorProps) {
  // Simulate class probabilities (in reality, this would come from the model)
  // For demonstration, we'll show the actual class with its confidence,
  // and distribute the remaining probability among other classes
  const allClasses: EventClass[] = ['BilabialPlosive', 'HihatNoise', 'Click', 'HumVoiced'];
  const otherConfidence = (1 - confidence) / (allClasses.length - 1);

  const classProbabilities = allClasses.map(cls => ({
    class: cls,
    probability: cls === className ? confidence : otherConfidence,
    color: EVENT_CLASS_COLORS[cls],
  })).sort((a, b) => b.probability - a.probability);

  // Feature display configuration
  const featureConfig = [
    {
      key: 'spectral_centroid',
      label: 'Spectral Centroid',
      value: features.spectral_centroid,
      unit: 'Hz',
      max: 8000,
      description: 'Center of mass of the spectrum (brightness)',
    },
    {
      key: 'zcr',
      label: 'Zero-Crossing Rate',
      value: features.zcr,
      unit: '',
      max: 1,
      description: 'Rate of sign changes (noisiness)',
    },
    {
      key: 'low_band_energy',
      label: 'Low Band Energy (0-200 Hz)',
      value: features.low_band_energy,
      unit: '',
      max: 1,
      description: 'Energy in bass frequencies',
    },
    {
      key: 'mid_band_energy',
      label: 'Mid Band Energy (200-2000 Hz)',
      value: features.mid_band_energy,
      unit: '',
      max: 1,
      description: 'Energy in mid frequencies',
    },
    {
      key: 'high_band_energy',
      label: 'High Band Energy (2000+ Hz)',
      value: features.high_band_energy,
      unit: '',
      max: 1,
      description: 'Energy in high frequencies',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        marginTop: '16px',
        border: '3px solid #000',
        borderRadius: '4px',
        padding: '20px',
        backgroundColor: '#F0F0F0',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      {/* Section Header */}
      <div style={{
        fontSize: '14px',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        color: '#666',
        letterSpacing: '0.5px',
      }}>
        Model Analysis
      </div>

      {/* Feature Values */}
      <div>
        <div style={{
          fontSize: '12px',
          fontWeight: 'bold',
          textTransform: 'uppercase',
          color: '#888',
          marginBottom: '12px',
        }}>
          Extracted Features
        </div>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          {featureConfig.map((feature) => (
            <div key={feature.key}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '4px',
              }}>
                <span style={{
                  fontSize: '12px',
                  fontWeight: 'bold',
                  color: '#333',
                }}>
                  {feature.label}
                </span>
                <span style={{
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  color: '#000',
                }}>
                  {feature.value.toFixed(2)}{feature.unit}
                </span>
              </div>
              <div style={{
                height: '8px',
                backgroundColor: '#DDD',
                border: '2px solid #000',
                borderRadius: '2px',
                overflow: 'hidden',
              }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(feature.value / feature.max) * 100}%` }}
                  transition={{ duration: 0.5, delay: 0.1 }}
                  style={{
                    height: '100%',
                    backgroundColor: '#000',
                  }}
                />
              </div>
              <div style={{
                fontSize: '10px',
                color: '#666',
                marginTop: '2px',
              }}>
                {feature.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Classification Scores */}
      <div>
        <div style={{
          fontSize: '12px',
          fontWeight: 'bold',
          textTransform: 'uppercase',
          color: '#888',
          marginBottom: '12px',
        }}>
          Classification Probabilities
        </div>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          {classProbabilities.map((item, index) => (
            <motion.div
              key={item.class}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + (index * 0.05) }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '4px',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}>
                  <div style={{
                    width: '12px',
                    height: '12px',
                    backgroundColor: item.color,
                    border: '2px solid #000',
                    borderRadius: '2px',
                  }} />
                  <span style={{
                    fontSize: '12px',
                    fontWeight: item.class === className ? 'bold' : 'normal',
                    color: '#333',
                  }}>
                    {item.class.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </div>
                <span style={{
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  color: '#000',
                }}>
                  {(item.probability * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{
                height: '12px',
                backgroundColor: '#DDD',
                border: '2px solid #000',
                borderRadius: '2px',
                overflow: 'hidden',
              }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${item.probability * 100}%` }}
                  transition={{ duration: 0.6, delay: 0.3 + (index * 0.05) }}
                  style={{
                    height: '100%',
                    backgroundColor: item.color,
                    border: item.class === className ? '1px solid #000' : 'none',
                  }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Explanation */}
      <div style={{
        border: '2px solid #000',
        borderRadius: '4px',
        padding: '12px',
        backgroundColor: '#FFFFFF',
        fontSize: '11px',
        lineHeight: '1.5',
        color: '#666',
      }}>
        <strong>How It Works:</strong> The model extracts acoustic features from each detected
        onset and computes a probability distribution over all event classes. The class with
        the highest probability is selected, along with its confidence score.
      </div>
    </motion.div>
  );
}
