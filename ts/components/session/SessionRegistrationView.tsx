import React from 'react';
import { AccentText } from './AccentText';

import { RegistrationTabs } from './RegistrationTabs';
import { SessionIconButton, SessionIconSize, SessionIconType } from './icon';
import { SessionToastContainer } from './SessionToastContainer';

export const SessionRegistrationView = () => (
  <div className="session-content">
    <SessionToastContainer />
    <div id="error" className="collapse" />
    <div className="session-content-header">
      <div className="session-content-close-button">
        <SessionIconButton
          iconSize={SessionIconSize.Medium}
          iconType={SessionIconType.Exit}
          onClick={() => {
            window.close();
          }}
        />
      </div>
      <div className="session-content-session-button">
        <img alt="brand" src="./images/session/brand.svg" />
      </div>
    </div>
    <div className="session-content-body">
      <div className="session-content-accent">
        <AccentText />
      </div>
      <div className="session-content-registration">
        <RegistrationTabs />
      </div>
    </div>
  </div>
);
