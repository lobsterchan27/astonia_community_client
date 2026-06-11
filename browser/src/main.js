const statusCard = document.querySelector('[data-testid="webgpu-status"]');
const statusTitle = document.querySelector('[data-webgpu-title]');
const statusDetail = document.querySelector('[data-webgpu-detail]');

function setWebGpuStatus(state, title, detail) {
  statusCard.dataset.webgpuState = state;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

async function probeWebGpu() {
  if (!('gpu' in navigator)) {
    setWebGpuStatus(
      'unavailable',
      'WebGPU unavailable',
      'This browser does not expose navigator.gpu. The shell is running without the GPU renderer.'
    );
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      setWebGpuStatus(
        'unavailable',
        'WebGPU unavailable',
        'navigator.gpu is present, but no adapter was granted. The shell is running without the GPU renderer.'
      );
      return;
    }

    const device = await adapter.requestDevice();
    device.destroy();

    setWebGpuStatus(
      'available',
      'WebGPU available',
      'A WebGPU adapter and device were created successfully.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown WebGPU error';
    setWebGpuStatus(
      'error',
      'WebGPU probe failed',
      `The browser shell is running without the GPU renderer. ${message}`
    );
  }
}

void probeWebGpu();
