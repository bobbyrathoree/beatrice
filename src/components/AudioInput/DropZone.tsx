import { useState, useRef, DragEvent } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import type { Project } from '../../store/useStore';

interface DropZoneProps {
  onProjectCreated: (project: Project) => void;
  onError: (error: string) => void;
}

interface FileInfo {
  name: string;
  size: number;
  duration: number | null;
}

export function DropZone({ onProjectCreated, onError }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndProcessFile = async (file: File) => {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.wav')) {
      onError('Only WAV files are supported');
      return;
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      onError('File size must be less than 50MB');
      return;
    }

    setIsProcessing(true);
    setFileInfo({
      name: file.name,
      size: file.size,
      duration: null,
    });

    try {
      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Create project via Tauri command
      const project = await invoke<Project>('create_project', {
        input: {
          name: file.name.replace('.wav', ''),
          input_data: Array.from(uint8Array),
        },
      });

      // Update file info with duration
      setFileInfo((prev) => prev ? {
        ...prev,
        duration: project.duration_ms,
      } : null);

      // Notify parent
      onProjectCreated(project);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process audio file';
      onError(errorMessage);
      setFileInfo(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    await validateAndProcessFile(file);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    await validateAndProcessFile(file);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      className="drop-zone"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      animate={{
        scale: isDragOver ? 1.02 : 1,
        borderColor: isDragOver ? '#FF00FF' : '#000000',
      }}
      whileHover={{
        scale: 1.01,
        transition: { type: 'spring', stiffness: 300, damping: 20 },
      }}
      whileTap={{ scale: 0.98 }}
      style={{
        border: '4px solid #000',
        borderRadius: '8px',
        padding: '48px 32px',
        cursor: 'pointer',
        backgroundColor: isDragOver ? '#FFFF00' : '#FFFFFF',
        transition: 'background-color 0.2s ease',
        position: 'relative',
        minHeight: '200px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,audio/wav"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {isProcessing ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div
            style={{
              fontSize: '48px',
              animation: 'spin 1s linear infinite',
            }}
          >
            ◆
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            PROCESSING...
          </div>
        </motion.div>
      ) : fileInfo ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
          }}
        >
          <div style={{ fontSize: '48px' }}>✓</div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 'bold',
              textAlign: 'center',
              wordBreak: 'break-word',
            }}
          >
            {fileInfo.name}
          </div>
          <div style={{ fontSize: '16px', color: '#666' }}>
            {formatFileSize(fileInfo.size)}
            {fileInfo.duration !== null && ` • ${formatDuration(fileInfo.duration)}`}
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div style={{ fontSize: '64px' }}>↓</div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              textAlign: 'center',
            }}
          >
            DROP WAV FILE HERE
          </div>
          <div style={{ fontSize: '16px', color: '#666' }}>
            or click to browse
          </div>
        </motion.div>
      )}

      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </motion.div>
  );
}
