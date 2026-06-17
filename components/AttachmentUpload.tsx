"use client";

import { useState } from "react";
import { useUploadAttachment } from "@/lib/hooks/useUploadAttachment";

interface AttachmentUploadProps {
  eventId: string;
  onFileUploaded?: (filePath: string) => void;
  maxFiles?: number;
}

export function AttachmentUpload({
  eventId,
  onFileUploaded,
  maxFiles = 5,
}: AttachmentUploadProps) {
  const { uploadAttachment, uploading, progress, error } =
    useUploadAttachment();
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ name: string; path: string }>
  >([]);

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.currentTarget.files;
    if (!files || files.length === 0) return;

    // Check max files limit
    if (uploadedFiles.length + files.length > maxFiles) {
      alert(`Maximum ${maxFiles} fichiers autorisés`);
      return;
    }

    // Upload each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert(`Fichier trop volumineux: ${file.name} (max 10MB)`);
        continue;
      }

      const filePath = await uploadAttachment(eventId, file);
      if (filePath) {
        setUploadedFiles((prev) => [
          ...prev,
          { name: file.name, path: filePath },
        ]);
        onFileUploaded?.(filePath);
      }
    }

    // Reset input
    e.currentTarget.value = "";
  };

  const removeFile = (path: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.path !== path));
  };

  return (
    <div className="space-y-3">
      {/* Upload input */}
      <div className="relative">
        <input
          type="file"
          multiple
          disabled={uploading || uploadedFiles.length >= maxFiles}
          onChange={handleFileSelect}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
          className="hidden"
          id={`attachment-${eventId}`}
        />
        <label
          htmlFor={`attachment-${eventId}`}
          className={`block border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer transition ${
            uploading || uploadedFiles.length >= maxFiles
              ? "opacity-50 cursor-not-allowed bg-gray-700"
              : "hover:border-gray-500 hover:bg-gray-700"
          }`}
        >
          <div className="text-sm text-gray-400">
            {uploading ? (
              <>
                <div className="text-yellow-400 font-semibold">
                  Upload: {progress?.fileName}
                </div>
                <div className="w-full bg-gray-600 h-2 rounded mt-2">
                  <div
                    className="bg-yellow-500 h-full rounded transition-all"
                    style={{ width: `${progress?.percent}%` }}
                  />
                </div>
              </>
            ) : uploadedFiles.length >= maxFiles ? (
              <span>Limite atteinte ({maxFiles} fichiers)</span>
            ) : (
              <>
                <span className="font-semibold text-gray-300">
                  Cliquez pour ajouter des fichiers
                </span>
                <br />
                <span className="text-xs text-gray-500">
                  Photos, PDF, documents (max 10MB)
                </span>
              </>
            )}
          </div>
        </label>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-900 bg-opacity-30 border border-red-600 text-red-300 text-sm p-2 rounded">
          {error}
        </div>
      )}

      {/* Uploaded files list */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase text-gray-400 font-semibold">
            {uploadedFiles.length} fichier{uploadedFiles.length > 1 ? "s" : ""}{" "}
            ajouté{uploadedFiles.length > 1 ? "s" : ""}
          </div>
          <div className="space-y-1">
            {uploadedFiles.map((file) => (
              <div
                key={file.path}
                className="flex items-center justify-between bg-gray-700 rounded p-2 text-sm"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-green-400">✓</span>
                  <span className="text-gray-300 truncate">{file.name}</span>
                </div>
                <button
                  onClick={() => removeFile(file.path)}
                  className="text-gray-400 hover:text-red-400 text-xs ml-2 flex-shrink-0"
                >
                  Retirer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
