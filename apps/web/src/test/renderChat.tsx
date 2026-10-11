import { render } from '@testing-library/react';
import { Chat } from '../components/Chat';
import { Providers } from '../components/Providers';

export const renderChat = () =>
  render(
    <Providers>
      <Chat />
    </Providers>,
  );
