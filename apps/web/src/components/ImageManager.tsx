import { useState, useRef, useCallback } from 'react';

type ImageManagerProps = {
  images: string[];
  onChange: (images: string[]) => void;
  maxImages?: number;
  apiUrl: string;
};

type UploadingState = {
  [key: string]: 'uploading' | 'success' | 'error';
};

export function ImageManager({ images, onChange, maxImages = 10, apiUrl }: ImageManagerProps) {
  const [uploading, setUploading] = useState<UploadingState>({});
  const [manualUrl, setManualUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subida global: navegador -> Worker (`POST /upload/imagekit`) -> ImageKit.
  // La private key nunca sale del servidor. Mantiene validación local
  // (tipo/tamaño) para fallar rápido sin gastar rate limit.
  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Solo se permiten imágenes JPEG, PNG, GIF o WebP');
      return null;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('La imagen debe ser menor a 5MB');
      return null;
    }

    const fileKey = `${Date.now()}-${file.name}`;
    setUploading(prev => ({ ...prev, [fileKey]: 'uploading' }));
    setError('');

    // --- Ruta global: vía servidor a ImageKit ---
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const response = await fetch(`${apiUrl}/upload/imagekit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, filename: file.name }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        setUploading(prev => ({ ...prev, [fileKey]: 'error' }));
        // Mensaje específico cuando falta la private key en el servidor
        if (data.error === 'SERVER_CONFIG_ERROR') {
          setError('Servicio de imágenes no configurado en el servidor (falta IMAGEKIT_PRIVATE_KEY). Ejecuta `wrangler secret put IMAGEKIT_PRIVATE_KEY`.');
        } else {
          setError(data.message || 'Error al subir la imagen');
        }
        return null;
      }

      setUploading(prev => ({ ...prev, [fileKey]: 'success' }));
      return data.data.url as string;
    } catch {
      setUploading(prev => ({ ...prev, [fileKey]: 'error' }));
      setError('Error de conexión al subir la imagen');
      return null;
    }
  }, [apiUrl]);

  // Handle file selection
  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    setError('');

    const remaining = maxImages - images.length;
    if (remaining <= 0) {
      setError(`Máximo ${maxImages} imágenes permitidas`);
      return;
    }

    const filesToUpload = Array.from(files).slice(0, remaining);
    // Acumular en variable local para evitar closure stale de `images`
    // (antes: onChange([...images, url]) perdía imágenes al subir varias seguidas)
    let updated = [...images];

    for (const file of filesToUpload) {
      const url = await uploadImage(file);
      if (url) {
        updated = [...updated, url];
        onChange(updated);
      }
    }

    // Reset input para permitir reseleccionar el mismo archivo
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [images, maxImages, onChange, uploadImage]);

  // Handle manual URL addition
  const handleAddManualUrl = useCallback(async () => {
    if (!manualUrl.trim()) return;
    setError('');

    // Validate URL format
    if (!/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(manualUrl)) {
      setError('URL de imagen no válida');
      return;
    }

    // Check for duplicates
    if (images.includes(manualUrl)) {
      setError('Esta imagen ya fue agregada');
      return;
    }

    if (images.length >= maxImages) {
      setError(`Máximo ${maxImages} imágenes permitidas`);
      return;
    }

    onChange([...images, manualUrl.trim()]);
    setManualUrl('');
  }, [manualUrl, images, maxImages, onChange]);

  // Remove image
  const handleRemoveImage = useCallback((index: number) => {
    onChange(images.filter((_, i) => i !== index));
  }, [images, onChange]);

  // Move image (reorder)
  const handleMoveImage = useCallback((fromIndex: number, direction: 'up' | 'down') => {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= images.length) return;

    const newImages = [...images];
    [newImages[fromIndex], newImages[toIndex]] = [newImages[toIndex], newImages[fromIndex]];
    onChange(newImages);
  }, [images, onChange]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="image-manager">
      {/* Hidden input for file selection */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => handleFiles(e.target.files)}
        style={{ display: 'none' }}
        aria-label="Seleccionar imágenes"
      />

      {/* Drag and drop zone */}
      <div
        className={`image-drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Zona de arrastre para subir imágenes"
      >
        <div className="drop-zone-content">
          <span className="drop-zone-icon" aria-hidden="true">📁</span>
          <p>Arrastra imágenes aquí o haz clic para seleccionar</p>
          <small>JPEG, PNG, GIF, WebP - Máximo 5MB por imagen</small>
        </div>
      </div>

      {/* Manual URL input */}
      <div className="manual-url-section">
        <div className="form-group">
          <label htmlFor="manual-url">Agregar imagen por URL:</label>
          <div className="url-input-group">
            <input
              id="manual-url"
              type="text"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddManualUrl())}
              placeholder="https://ejemplo.com/imagen.jpg"
              className="url-input"
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleAddManualUrl}
              disabled={!manualUrl.trim()}
            >
              Agregar
            </button>
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      {/* Selected images grid */}
      {images.length > 0 && (
        <div className="selected-images">
          <h4>Imágenes seleccionadas ({images.length}/{maxImages})</h4>
          <div className="images-grid">
            {images.map((url, index) => (
              <div key={`${url}-${index}`} className="image-item">
                <img
                  src={url}
                  alt={`Imagen ${index + 1}`}
                  className="image-thumbnail"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23333" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="20"%3EError%3C/text%3E%3C/svg%3E';
                  }}
                />
                <div className="image-actions">
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => handleMoveImage(index, 'up')}
                    disabled={index === 0}
                    aria-label="Mover imagen arriba"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => handleMoveImage(index, 'down')}
                    disabled={index === images.length - 1}
                    aria-label="Mover imagen abajo"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn-icon btn-danger"
                    onClick={() => handleRemoveImage(index)}
                    aria-label="Eliminar imagen"
                  >
                    ✕
                  </button>
                </div>
                {index === 0 && (
                  <span className="primary-badge">Principal</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden input with final array */}
      <input
        type="hidden"
        name="images"
        value={JSON.stringify(images)}
        readOnly
      />
    </div>
  );
}
