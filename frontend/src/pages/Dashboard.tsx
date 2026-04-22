import { useCallback, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ProjectTable } from "../components/ProjectTable";
import { SettingsModal } from "../components/SettingsModal";
import { UrgentBell } from "../components/UrgentBell";

export function Dashboard() {
  const { user, logout, refresh } = useAuth();
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [urgentRefreshToken, setUrgentRefreshToken] = useState(0);
  const [listRefreshToken, setListRefreshToken] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const onPortfolioChanged = useCallback(() => {
    setUrgentRefreshToken((n) => n + 1);
  }, []);

  const onCadenceSettingsSaved = useCallback(() => {
    void refresh();
    setListRefreshToken((n) => n + 1);
    setUrgentRefreshToken((n) => n + 1);
  }, [refresh]);

  async function onLogout() {
    await logout();
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header__row">
          <div>
            <h1>PM Helper</h1>
            <p className="app__tagline">
              Project portfolio — priority sorting and inline updates
            </p>
            {user ? (
              <p className="app__user-line">
                Signed in as <strong>{user.fullName}</strong> ({user.email})
              </p>
            ) : null}
          </div>
          <div className="app__header__actions">
            <UrgentBell
              urgentOnly={urgentOnly}
              onToggleUrgent={() => setUrgentOnly((v) => !v)}
              refreshToken={urgentRefreshToken}
            />
            <button type="button" className="btn btn--ghost" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => void onLogout()}>
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="app__main">
        <ProjectTable
          urgentOnly={urgentOnly}
          onUrgentOnlyChange={setUrgentOnly}
          onPortfolioChanged={onPortfolioChanged}
          listRefreshToken={listRefreshToken}
        />
      </main>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={onCadenceSettingsSaved}
      />
    </div>
  );
}
