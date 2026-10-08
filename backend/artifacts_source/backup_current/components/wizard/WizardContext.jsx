import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '@/lib/api';

const WizardContext = createContext(null);

const INIT = {
  step: 0, maxStep: 0,
  source: 'file', dbMode: 'RUNNING',
  config: {
    importType: 'STOCK', postMode: 'LEGACY', purchaseAccount: '',
    dateOrder: 'DMY', numberStyle: 'DOT', region: 'en-IN',
    dupKeyColumns: 'OEMCode', dupMode: 'ERROR', chunkSize: 50000, remarks: '',
  },
  batchId: null,
  file: null, columns: [], rows: [], colStats: [],
  columnMapping: {}, transforms: {}, defaults: {}, applyDefaults: true,
  masters: null, apiHealth: null,
  suppliersData: { mode: 'column', suppliers: [], singleName: '', singleExisting: '', resolution: {} },
  masterMapData: { resolution: {}, masterMap: null, initialized: false },
  validateData: null, gateData: null,
};

export function WizardProvider({ children }) {
  const [ws, setWs] = useState(INIT);

  const patch = useCallback((u) => setWs(p => {
    const n = { ...p, ...u };
    if (u.step !== undefined && u.step > p.maxStep) n.maxStep = u.step;
    return n;
  }), []);

  const reset = useCallback(() => setWs(INIT), []);

  // Load API health + masters once on mount
  useEffect(() => {
    api.get('/health').then(({ data: h }) => {
      setWs(p => ({ ...p, apiHealth: h }));
      if (h.connected) {
        api.get('/masters').then(({ data: m }) => {
          // Support both { masters: {...} } and flat { vendormaster: [...] }
          setWs(p => ({ ...p, masters: m.masters || m }));
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  return (
    <WizardContext.Provider value={{ ws, patch, reset }}>
      {children}
    </WizardContext.Provider>
  );
}

export const useWizard = () => useContext(WizardContext);
