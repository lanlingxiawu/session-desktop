import { expect } from 'chai';
import * as crypto from 'crypto';
import Sinon, * as sinon from 'sinon';
import { MessageSender } from '../../../../session/sending';
import { TestUtils } from '../../../test-utils';
import { MessageEncrypter } from '../../../../session/crypto';
import { SignalService } from '../../../../protobuf';
import { PubKey, RawMessage } from '../../../../session/types';
import { MessageUtils, UserUtils } from '../../../../session/utils';
import { SNodeAPI } from '../../../../session/apis/snode_api';
import _ from 'lodash';
import { OpenGroupPollingUtils } from '../../../../session/apis/open_group_api/opengroupV2/OpenGroupPollingUtils';
import { TEST_identityKeyPair } from '../crypto/MessageEncrypter_test';
import { stubCreateObjectUrl, stubData, stubUtilWorker } from '../../../test-utils/utils';
import { SogsBlinding } from '../../../../session/apis/open_group_api/sogsv3/sogsBlinding';
import { Onions } from '../../../../session/apis/snode_api/onions';
import { OnionV4 } from '../../../../session/onions/onionv4';
import { OnionSending } from '../../../../session/onions/onionSend';
import { OpenGroupMessageV2 } from '../../../../session/apis/open_group_api/opengroupV2/OpenGroupMessageV2';

describe('MessageSender', () => {
  afterEach(() => {
    sinon.restore();
  });

  beforeEach(() => {
    TestUtils.stubWindowLog();
  });

  // tslint:disable-next-line: max-func-body-length
  describe('send', () => {
    const ourNumber = '0123456789abcdef';
    let sessionMessageAPISendStub: sinon.SinonStub<any>;
    let encryptStub: sinon.SinonStub<[PubKey, Uint8Array, SignalService.Envelope.Type]>;

    beforeEach(() => {
      sessionMessageAPISendStub = Sinon.stub(MessageSender, 'sendMessageToSnode').resolves();

      stubData('getMessageById').resolves();

      encryptStub = Sinon.stub(MessageEncrypter, 'encrypt').resolves({
        envelopeType: SignalService.Envelope.Type.SESSION_MESSAGE,
        cipherText: crypto.randomBytes(10),
      });

      Sinon.stub(UserUtils, 'getOurPubKeyStrFromCache').returns(ourNumber);
    });

    describe('retry', () => {
      let rawMessage: RawMessage;

      beforeEach(async () => {
        rawMessage = await MessageUtils.toRawMessage(
          TestUtils.generateFakePubKey(),
          TestUtils.generateVisibleMessage()
        );
      });

      it('should not retry if an error occurred during encryption', async () => {
        encryptStub.throws(new Error('Failed to encrypt.'));
        const promise = MessageSender.send(rawMessage, 3, 10);
        await expect(promise).is.rejectedWith('Failed to encrypt.');
        expect(sessionMessageAPISendStub.callCount).to.equal(0);
      });

      it('should only call lokiMessageAPI once if no errors occured', async () => {
        await MessageSender.send(rawMessage, 3, 10);
        expect(sessionMessageAPISendStub.callCount).to.equal(1);
      });

      it('should only retry the specified amount of times before throwing', async () => {
        // const clock = sinon.useFakeTimers();

        sessionMessageAPISendStub.throws(new Error('API error'));
        const attempts = 2;
        const promise = MessageSender.send(rawMessage, attempts, 10);
        await expect(promise).is.rejectedWith('API error');
        // clock.restore();
        expect(sessionMessageAPISendStub.callCount).to.equal(attempts);
      });

      it('should not throw error if successful send occurs within the retry limit', async () => {
        sessionMessageAPISendStub.onFirstCall().throws(new Error('API error'));
        await MessageSender.send(rawMessage, 3, 10);
        expect(sessionMessageAPISendStub.callCount).to.equal(2);
      });
    });

    describe('logic', () => {
      let messageEncyrptReturnEnvelopeType = SignalService.Envelope.Type.SESSION_MESSAGE;

      beforeEach(() => {
        encryptStub.callsFake(async (_device, plainTextBuffer, _type) => ({
          envelopeType: messageEncyrptReturnEnvelopeType,
          cipherText: plainTextBuffer,
        }));
      });

      it('should pass the correct values to lokiMessageAPI', async () => {
        const device = TestUtils.generateFakePubKey();
        const visibleMessage = TestUtils.generateVisibleMessage();

        const rawMessage = await MessageUtils.toRawMessage(device, visibleMessage);

        await MessageSender.send(rawMessage, 3, 10);

        const args = sessionMessageAPISendStub.getCall(0).args;
        expect(args[0]).to.equal(device.key);
        // expect(args[3]).to.equal(visibleMessage.timestamp); the timestamp is overwritten on sending by the network clock offset
        expect(args[2]).to.equal(visibleMessage.ttl());
      });

      it('should correctly build the envelope and override the timestamp', async () => {
        messageEncyrptReturnEnvelopeType = SignalService.Envelope.Type.SESSION_MESSAGE;

        // This test assumes the encryption stub returns the plainText passed into it.
        const device = TestUtils.generateFakePubKey();

        const visibleMessage = TestUtils.generateVisibleMessage();
        const rawMessage = await MessageUtils.toRawMessage(device, visibleMessage);
        const offset = 200000;
        Sinon.stub(SNodeAPI, 'getLatestTimestampOffset').returns(offset);
        await MessageSender.send(rawMessage, 3, 10);

        const data = sessionMessageAPISendStub.getCall(0).args[1];
        const webSocketMessage = SignalService.WebSocketMessage.decode(data);
        expect(webSocketMessage.request?.body).to.not.equal(
          undefined,
          'Request body should not be undefined'
        );
        expect(webSocketMessage.request?.body).to.not.equal(
          null,
          'Request body should not be null'
        );

        const envelope = SignalService.Envelope.decode(
          webSocketMessage.request?.body as Uint8Array
        );
        expect(envelope.type).to.equal(SignalService.Envelope.Type.SESSION_MESSAGE);
        expect(envelope.source).to.equal('');

        // the timestamp is overridden on sending with the network offset
        const expectedTimestamp = Date.now() - offset;
        const decodedTimestampFromSending = _.toNumber(envelope.timestamp);
        expect(decodedTimestampFromSending).to.be.above(expectedTimestamp - 10);
        expect(decodedTimestampFromSending).to.be.below(expectedTimestamp + 10);

        // then make sure the plaintextBuffer was overriden too
        const visibleMessageExpected = TestUtils.generateVisibleMessage({
          timestamp: decodedTimestampFromSending,
        });
        const rawMessageExpected = await MessageUtils.toRawMessage(device, visibleMessageExpected);

        expect(envelope.content).to.deep.equal(rawMessageExpected.plainTextBuffer);
      });

      describe('SESSION_MESSAGE', () => {
        it('should set the envelope source to be empty', async () => {
          messageEncyrptReturnEnvelopeType = SignalService.Envelope.Type.SESSION_MESSAGE;

          // This test assumes the encryption stub returns the plainText passed into it.
          const device = TestUtils.generateFakePubKey();

          const visibleMessage = TestUtils.generateVisibleMessage();
          const rawMessage = await MessageUtils.toRawMessage(device, visibleMessage);
          await MessageSender.send(rawMessage, 3, 10);

          const data = sessionMessageAPISendStub.getCall(0).args[1];
          const webSocketMessage = SignalService.WebSocketMessage.decode(data);
          expect(webSocketMessage.request?.body).to.not.equal(
            undefined,
            'Request body should not be undefined'
          );
          expect(webSocketMessage.request?.body).to.not.equal(
            null,
            'Request body should not be null'
          );

          const envelope = SignalService.Envelope.decode(
            webSocketMessage.request?.body as Uint8Array
          );
          expect(envelope.type).to.equal(SignalService.Envelope.Type.SESSION_MESSAGE);
          expect(envelope.source).to.equal(
            '',
            'envelope source should be empty in SESSION_MESSAGE'
          );
        });
      });
    });
  });

  describe('sendToOpenGroupV2', () => {
    beforeEach(() => {
      Sinon.stub(UserUtils, 'getOurPubKeyStrFromCache').resolves(
        TestUtils.generateFakePubKey().key
      );
      Sinon.stub(UserUtils, 'getIdentityKeyPair').resolves(TEST_identityKeyPair);

      Sinon.stub(SogsBlinding, 'getSogsSignature').resolves(new Uint8Array());

      stubUtilWorker('arrayBufferToStringBase64', 'ba64');
      Sinon.stub(OnionSending, 'getOnionPathForSending').resolves([{}] as any);
      Sinon.stub(OnionSending, 'endpointRequiresDecoding').returnsArg(0);

      stubData('getGuardNodes').resolves([]);

      Sinon.stub(OpenGroupPollingUtils, 'getAllValidRoomInfos').returns([
        { roomId: 'room', serverPublicKey: 'whatever', serverUrl: 'serverUrl' },
      ]);
      Sinon.stub(OpenGroupPollingUtils, 'getOurOpenGroupHeaders').resolves({
        'X-SOGS-Pubkey': '00bac6e71efd7dfa4a83c98ed24f254ab2c267f9ccdb172a5280a0444ad24e89cc',
        'X-SOGS-Timestamp': '1642472103',
        'X-SOGS-Nonce': 'CdB5nyKVmQGCw6s0Bvv8Ww==',
        'X-SOGS-Signature':
          'gYqpWZX6fnF4Gb2xQM3xaXs0WIYEI49+B8q4mUUEg8Rw0ObaHUWfoWjMHMArAtP9QlORfiydsKWz1o6zdPVeCQ==',
      });
      stubCreateObjectUrl();

      Sinon.stub(OpenGroupMessageV2, 'fromJson').resolves();
    });

    afterEach(() => {
      Sinon.restore();
    });

    it('should call sendOnionRequestHandlingSnodeEjectStub', async () => {
      const sendOnionRequestHandlingSnodeEjectStub = Sinon.stub(
        Onions,
        'sendOnionRequestHandlingSnodeEject'
      ).resolves({} as any);
      Sinon.stub(OnionV4, 'decodeV4Response').returns({
        metadata: { code: 200 },
        body: {},
        bodyBinary: new Uint8Array(),
        bodyContentType: 'a',
      });
      const message = TestUtils.generateOpenGroupVisibleMessage();
      const roomInfos = TestUtils.generateOpenGroupV2RoomInfos();

      await MessageSender.sendToOpenGroupV2(message, roomInfos, false, []);
      expect(sendOnionRequestHandlingSnodeEjectStub.callCount).to.eq(1);
    });

    it('should retry sendOnionRequestHandlingSnodeEjectStub ', async () => {
      const message = TestUtils.generateOpenGroupVisibleMessage();
      const roomInfos = TestUtils.generateOpenGroupV2RoomInfos();
      Sinon.stub(Onions, 'sendOnionRequestHandlingSnodeEject').resolves({} as any);

      const decodev4responseStub = Sinon.stub(OnionV4, 'decodeV4Response');
      decodev4responseStub.throws('whate');

      decodev4responseStub.onThirdCall().returns({
        metadata: { code: 200 },
        body: {},
        bodyBinary: new Uint8Array(),
        bodyContentType: 'a',
      });
      await MessageSender.sendToOpenGroupV2(message, roomInfos, false, []);
      expect(decodev4responseStub.callCount).to.eq(3);
    });

    it('should not retry more than 3 sendOnionRequestHandlingSnodeEjectStub ', async () => {
      const message = TestUtils.generateOpenGroupVisibleMessage();
      const roomInfos = TestUtils.generateOpenGroupV2RoomInfos();
      Sinon.stub(Onions, 'sendOnionRequestHandlingSnodeEject').resolves({} as any);

      const decodev4responseStub = Sinon.stub(OnionV4, 'decodeV4Response');
      decodev4responseStub.throws('whate');

      decodev4responseStub.onCall(4).returns({
        metadata: { code: 200 },
        body: {},
        bodyBinary: new Uint8Array(),
        bodyContentType: 'a',
      });
      try {
        await MessageSender.sendToOpenGroupV2(message, roomInfos, false, []);
        // tslint:disable-next-line: no-empty
      } catch (e) {}
      // we made the fourth call success, but we should not get there. We should stop at 3 the retries (1+2)
      expect(decodev4responseStub.calledThrice);
    });
  });
});
