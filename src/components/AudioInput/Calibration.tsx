import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';

interface CalibrationProps {
  onComplete: (profileId: string) => void;
  onCancel: () => void;
}

interface EventClass {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon: string;
  color: string;
}

const EVENT_CLASSES: EventClass[] = [
  {
    id: 'bilabial_plosive',
    name: 'bilabial_plosive',
    displayName: 'B/P (Kick)',
    description: 'Do 10 "BA" or "PA" hits',
    icon: '●',
    color: '#FF0000',
  },
  {
    id: 'hihat_noise',
    name: 'hihat_noise',
    displayName: 'S/TS (Hi-hat)',
    description: 'Do 10 "TSS" or "SSH" hits',
    icon: '◇',
    color: '#00FFFF',
  },
  {
    id: 'click',
    name: 'click',
    displayName: 'T/K (Snare)',
    description: 'Do 10 "T" or "K" clicks',
    icon: '■',
    color: '#00FF00',
  },
  {
    id: 'hum_voiced',
    name: 'hum_voiced',
    displayName: 'Hum (Pad)',
    description: 'Do 10 hummed or voiced sounds',
    icon: '~',
    color: '#FF00FF',
  },
];

type CalibrationStep = 'intro' | 'recording' | 'processing' | 'complete';

interface CalibrationSample {
  class: string;
  features: any;
  raw_window: number[];
  sample_rate: number;
}

export function Calibration({ onComplete, onCancel }: CalibrationProps) {
  const [step, setStep] = useState<CalibrationStep>('intro');
  const [currentClassIndex, setCurrentClassIndex] = useState(0);
  const [samplesForCurrentClass, setSamplesForCurrentClass] = useState<CalibrationSample[]>([]);
  const [allSamples, setAllSamples] = useState<Record<string, CalibrationSample[]>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [profileName, setProfileName] = useState('');

  const currentClass = EVENT_CLASSES[currentClassIndex];
  const requiredSamplesPerClass = 10;
  const currentProgress = samplesForCurrentClass.length;

  useEffect(() => {
    // Auto-advance to next class when current class has enough samples
    if (currentProgress >= requiredSamplesPerClass && step === 'recording') {
      setTimeout(() => {
        // Store samples for this class
        setAllSamples((prev) => ({
          ...prev,
          [currentClass.name]: [...samplesForCurrentClass],
        }));

        if (currentClassIndex < EVENT_CLASSES.length - 1) {
          // Move to next class
          setCurrentClassIndex(currentClassIndex + 1);
          setSamplesForCurrentClass([]);
        } else {
          // All classes complete
          setStep('complete');
        }
      }, 500);
    }
  }, [currentProgress, currentClassIndex, step, samplesForCurrentClass, currentClass.name]);

  const handleStartCalibration = () => {
    if (!profileName.trim()) {
      alert('Please enter a profile name');
      return;
    }
    setStep('recording');
  };

  const handleRecordSample = async () => {
    setIsRecording(true);
    setRecordingProgress(0);

    try {
      // Simulate recording for 500ms
      // In a real implementation, you would capture audio from microphone
      const recordingDuration = 500; // ms
      const interval = setInterval(() => {
        setRecordingProgress((prev) => {
          const next = prev + 10;
          if (next >= 100) {
            clearInterval(interval);
          }
          return Math.min(next, 100);
        });
      }, recordingDuration / 10);

      // Wait for recording to complete
      await new Promise((resolve) => setTimeout(resolve, recordingDuration));

      // Generate mock audio data (in real app, this would come from microphone)
      const mockAudioData = generateMockAudioData(currentClass.name);

      // Extract features from the audio segment
      const features = await invoke<any>('extract_features', {
        input: {
          audio_data: mockAudioData,
          start_ms: 0,
          duration_ms: 50,
        },
      });

      // Create calibration sample
      const sample: CalibrationSample = {
        class: currentClass.name,
        features,
        raw_window: Array.from(mockAudioData.slice(0, 2048)), // First 2048 samples
        sample_rate: 44100,
      };

      setSamplesForCurrentClass((prev) => [...prev, sample]);
    } catch (err) {
      console.error('Failed to record sample:', err);
      alert('Failed to record sample. Please try again.');
    } finally {
      setIsRecording(false);
      setRecordingProgress(0);
    }
  };

  const handleSaveProfile = async () => {
    setStep('processing');

    try {
      // Combine all samples into calibration profile
      const samplesMap: Record<string, CalibrationSample[]> = {
        ...allSamples,
        [currentClass.name]: samplesForCurrentClass,
      };

      const profile = {
        name: profileName,
        samples: samplesMap,
        version: 1,
        created_at: new Date().toISOString(),
        notes: `Calibrated with ${Object.values(samplesMap).reduce((sum, arr) => sum + arr.length, 0)} samples`,
      };

      // Serialize profile to JSON
      const profileData = new TextEncoder().encode(JSON.stringify(profile));

      // Save via Tauri command
      const result = await invoke<any>('create_calibration_profile', {
        input: {
          name: profileName,
          profile_data: Array.from(profileData),
          notes: profile.notes,
        },
      });

      onComplete(result.id);
    } catch (err) {
      console.error('Failed to save profile:', err);
      alert('Failed to save calibration profile. Please try again.');
      setStep('complete');
    }
  };

  const renderIntro = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        maxWidth: '600px',
      }}
    >
      <h2 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>
        TEACH BEATRICE YOUR BA
      </h2>

      <p style={{ fontSize: '18px', lineHeight: '1.6' }}>
        Calibrate Beatrice to recognize your unique beatbox sounds.
        You'll record 10 samples for each of the 4 sound types.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {EVENT_CLASSES.map((eventClass) => (
          <div
            key={eventClass.id}
            style={{
              border: '3px solid #000',
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              backgroundColor: '#fff',
            }}
          >
            <div
              style={{
                fontSize: '32px',
                color: eventClass.color,
                fontWeight: 'bold',
              }}
            >
              {eventClass.icon}
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                {eventClass.displayName}
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>
                {eventClass.description}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ fontSize: '16px', fontWeight: 'bold' }}>
          Profile Name
        </label>
        <input
          type="text"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          placeholder="My Beatbox Style"
          style={{
            border: '3px solid #000',
            padding: '12px 16px',
            fontSize: '18px',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '16px' }}>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleStartCalibration}
          style={{
            flex: 1,
            border: '4px solid #000',
            padding: '16px 32px',
            fontSize: '20px',
            fontWeight: 'bold',
            backgroundColor: '#FF00FF',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          START CALIBRATION
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onCancel}
          style={{
            border: '4px solid #000',
            padding: '16px 32px',
            fontSize: '20px',
            fontWeight: 'bold',
            backgroundColor: '#FFFFFF',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          CANCEL
        </motion.button>
      </div>
    </motion.div>
  );

  const renderRecording = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '32px',
        maxWidth: '600px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>
          CALIBRATING...
        </h2>
        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
          {currentClassIndex + 1} / {EVENT_CLASSES.length}
        </div>
      </div>

      <div
        style={{
          border: '4px solid #000',
          padding: '32px',
          backgroundColor: currentClass.color + '20',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        <div
          style={{
            fontSize: '64px',
            color: currentClass.color,
            fontWeight: 'bold',
          }}
        >
          {currentClass.icon}
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {currentClass.displayName}
          </div>
          <div style={{ fontSize: '18px', color: '#666', marginTop: '8px' }}>
            {currentClass.description}
          </div>
        </div>

        <div style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px',
              fontSize: '18px',
              fontWeight: 'bold',
            }}
          >
            <span>Progress</span>
            <span>
              {currentProgress} / {requiredSamplesPerClass}
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '24px',
              border: '3px solid #000',
              backgroundColor: '#fff',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{
                width: `${(currentProgress / requiredSamplesPerClass) * 100}%`,
              }}
              transition={{ type: 'spring', stiffness: 100, damping: 15 }}
              style={{
                height: '100%',
                backgroundColor: currentClass.color,
              }}
            />
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleRecordSample}
          disabled={isRecording || currentProgress >= requiredSamplesPerClass}
          style={{
            border: '4px solid #000',
            padding: '16px 48px',
            fontSize: '24px',
            fontWeight: 'bold',
            backgroundColor: isRecording ? '#FFFF00' : '#00FF00',
            cursor: isRecording || currentProgress >= requiredSamplesPerClass ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            opacity: isRecording || currentProgress >= requiredSamplesPerClass ? 0.6 : 1,
            position: 'relative',
          }}
        >
          {isRecording ? (
            <>
              RECORDING...
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  height: '4px',
                  width: `${recordingProgress}%`,
                  backgroundColor: '#FF0000',
                  transition: 'width 0.1s linear',
                }}
              />
            </>
          ) : currentProgress >= requiredSamplesPerClass ? (
            'COMPLETE!'
          ) : (
            'RECORD SAMPLE'
          )}
        </motion.button>
      </div>
    </motion.div>
  );

  const renderComplete = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '32px',
        maxWidth: '600px',
        alignItems: 'center',
      }}
    >
      <div style={{ fontSize: '96px' }}>✓</div>

      <h2 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0, textAlign: 'center' }}>
        CALIBRATION COMPLETE!
      </h2>

      <p style={{ fontSize: '18px', textAlign: 'center', lineHeight: '1.6' }}>
        You've recorded {EVENT_CLASSES.length * requiredSamplesPerClass} samples.
        Beatrice is now calibrated to your unique beatbox style!
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
        {EVENT_CLASSES.map((eventClass) => (
          <div
            key={eventClass.id}
            style={{
              border: '3px solid #000',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '24px', color: eventClass.color }}>
                {eventClass.icon}
              </div>
              <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                {eventClass.displayName}
              </div>
            </div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#00FF00' }}>
              ✓ {requiredSamplesPerClass} samples
            </div>
          </div>
        ))}
      </div>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleSaveProfile}
        style={{
          border: '4px solid #000',
          padding: '16px 48px',
          fontSize: '24px',
          fontWeight: 'bold',
          backgroundColor: '#00FFFF',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        SAVE PROFILE
      </motion.button>
    </motion.div>
  );

  const renderProcessing = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px',
      }}
    >
      <div
        style={{
          fontSize: '64px',
          animation: 'spin 1s linear infinite',
        }}
      >
        ◆
      </div>
      <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
        SAVING PROFILE...
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </motion.div>
  );

  return (
    <div
      style={{
        border: '4px solid #000',
        padding: '48px',
        backgroundColor: '#FFFFFF',
        minHeight: '400px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AnimatePresence mode="wait">
        {step === 'intro' && renderIntro()}
        {step === 'recording' && renderRecording()}
        {step === 'complete' && renderComplete()}
        {step === 'processing' && renderProcessing()}
      </AnimatePresence>
    </div>
  );
}

// Mock audio data generator (in real app, this would come from microphone)
function generateMockAudioData(className: string): Uint8Array {
  // Generate a simple WAV file header + mock audio data
  const sampleRate = 44100;
  const duration = 0.5; // 500ms
  const numSamples = Math.floor(sampleRate * duration);

  // WAV header (44 bytes) + audio data
  const wavHeader = new Uint8Array(44);
  const audioData = new Int16Array(numSamples);

  // Generate different waveforms based on class
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    switch (className) {
      case 'bilabial_plosive':
        // Low frequency impulse
        sample = Math.exp(-t * 20) * Math.sin(2 * Math.PI * 80 * t);
        break;
      case 'hihat_noise':
        // High frequency noise
        sample = (Math.random() - 0.5) * Math.exp(-t * 10);
        break;
      case 'click':
        // Sharp transient
        sample = Math.exp(-t * 30) * Math.sin(2 * Math.PI * 1000 * t);
        break;
      case 'hum_voiced':
        // Sustained harmonic
        sample = 0.5 * Math.sin(2 * Math.PI * 200 * t) + 0.3 * Math.sin(2 * Math.PI * 400 * t);
        break;
    }

    audioData[i] = Math.floor(sample * 32767 * 0.5);
  }

  // Simple WAV header
  const view = new DataView(wavHeader.buffer);
  // "RIFF"
  view.setUint32(0, 0x52494646, false);
  // File size
  view.setUint32(4, 36 + numSamples * 2, true);
  // "WAVE"
  view.setUint32(8, 0x57415645, false);
  // "fmt "
  view.setUint32(12, 0x666d7420, false);
  // Fmt chunk size
  view.setUint32(16, 16, true);
  // Audio format (PCM)
  view.setUint16(20, 1, true);
  // Channels
  view.setUint16(22, 1, true);
  // Sample rate
  view.setUint32(24, sampleRate, true);
  // Byte rate
  view.setUint32(28, sampleRate * 2, true);
  // Block align
  view.setUint16(32, 2, true);
  // Bits per sample
  view.setUint16(34, 16, true);
  // "data"
  view.setUint32(36, 0x64617461, false);
  // Data size
  view.setUint32(40, numSamples * 2, true);

  // Combine header and audio data
  const result = new Uint8Array(44 + numSamples * 2);
  result.set(wavHeader);
  result.set(new Uint8Array(audioData.buffer), 44);

  return result;
}
