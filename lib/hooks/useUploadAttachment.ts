import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface UploadProgress {
  percent: number;
  fileName: string;
}

export function useUploadAttachment() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadAttachment = async (
    eventId: string,
    file: File
  ): Promise<string | null> => {
    setUploading(true);
    setError(null);
    setProgress({ percent: 0, fileName: file.name });

    try {
      const supabase = createClient();

      // Generate unique file path: event-{eventId}/{timestamp}-{filename}
      const timestamp = Date.now();
      const fileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const filePath = `event-${eventId}/${timestamp}-${fileName}`;

      // Upload to Supabase Storage
      const { data, error: uploadError } = await (supabase.storage
        .from("event-attachments")
        .upload(filePath, file)) as any;

      if (uploadError) {
        throw uploadError;
      }

      setProgress({ percent: 70, fileName: file.name });

      // Save attachment metadata to database
      const { error: dbError } = await ((supabase as any)
        .from("attachments")
        .insert({
          event_id: eventId,
          file_path: filePath,
          file_name: file.name,
          file_size: file.size,
          created_at: new Date().toISOString(),
        }));

      if (dbError) {
        // Clean up uploaded file if DB insert fails
        await (supabase.storage
          .from("event-attachments")
          .remove([filePath])) as any;
        throw dbError;
      }

      setProgress({ percent: 100, fileName: file.name });
      return filePath;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Erreur d'upload";
      setError(errorMessage);
      console.error("Upload error:", err);
      return null;
    } finally {
      setUploading(false);
      setTimeout(() => setProgress(null), 1000);
    }
  };

  const getFileUrl = (filePath: string): string => {
    const supabase = createClient();
    const { data } = (supabase.storage
      .from("event-attachments")
      .getPublicUrl(filePath)) as any;
    return data.publicUrl;
  };

  return {
    uploadAttachment,
    getFileUrl,
    uploading,
    progress,
    error,
  };
}
