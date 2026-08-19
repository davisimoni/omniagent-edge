'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Developer Mode.
 *
 * Una modalità di lettura, non di modifica: accende i badge che spiegano le
 * scelte architetturali accanto ai componenti che le realizzano. Serve a chi
 * valuta com'è fatto il software — un tecnico, chi assume — e va tenuta **spenta
 * per impostazione predefinita**, perché per chi deve solo revisionare un
 * contratto quei badge sono rumore sopra il lavoro.
 *
 * Lo stato vive in `localStorage` e viene letto dopo il montaggio, mai durante
 * il render del server: leggerlo prima produrrebbe un markup diverso fra server
 * e client e React scarterebbe l'albero al primo passaggio. Il prezzo è un
 * fotogramma con i badge spenti, che è esattamente lo stato predefinito e quindi
 * non si nota.
 */

const STORAGE_KEY = 'omniagent-dev-mode';

interface DevModeValue {
  readonly enabled: boolean;
  readonly toggle: () => void;
  readonly setEnabled: (value: boolean) => void;
}

const DevModeContext = createContext<DevModeValue>({
  enabled: false,
  toggle: () => undefined,
  setEnabled: () => undefined,
});

export function DevModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    try {
      setEnabledState(window.localStorage.getItem(STORAGE_KEY) === 'on');
    } catch {
      /* Preferenza non leggibile (Safari privato, cookie di terze parti bloccati
         in iframe): resta lo stato predefinito, che è spento. */
    }
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
    } catch {
      /* La modalità funziona comunque per questa sessione. */
    }
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  return (
    <DevModeContext.Provider value={{ enabled, toggle, setEnabled }}>
      {children}
    </DevModeContext.Provider>
  );
}

export function useDevMode(): DevModeValue {
  return useContext(DevModeContext);
}
