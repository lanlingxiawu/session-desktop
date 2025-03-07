import React from 'react';
import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { MessageRenderingProps } from '../../../../models/messageType';
import { PubKey } from '../../../../session/types';
import {
  getMessageAuthorProps,
  getSelectedConversationIsGroup,
  isPublicGroupConversation,
} from '../../../../state/selectors/conversations';
import { Flex } from '../../../basic/Flex';
import { ContactName } from '../../ContactName';

export type MessageAuthorSelectorProps = Pick<
  MessageRenderingProps,
  'authorName' | 'authorProfileName' | 'sender' | 'direction' | 'firstMessageOfSeries'
>;

type Props = {
  messageId: string;
};

const StyledAuthorContainer = styled(Flex)`
  color: var(--text-primary-color);
`;

export const MessageAuthorText = (props: Props) => {
  const selected = useSelector(state => getMessageAuthorProps(state as any, props.messageId));

  const isPublic = useSelector(isPublicGroupConversation);
  const isGroup = useSelector(getSelectedConversationIsGroup);
  if (!selected) {
    return null;
  }
  const { authorName, sender, authorProfileName, direction, firstMessageOfSeries } = selected;

  const title = authorName ? authorName : sender;

  if (direction !== 'incoming' || !isGroup || !title || !firstMessageOfSeries) {
    return null;
  }

  const displayedPubkey = authorProfileName ? PubKey.shorten(sender) : sender;

  return (
    <StyledAuthorContainer container={true}>
      <ContactName
        pubkey={displayedPubkey}
        name={authorName}
        profileName={authorProfileName}
        module="module-message__author"
        boldProfileName={true}
        shouldShowPubkey={Boolean(isPublic)}
      />
    </StyledAuthorContainer>
  );
};
