import { useState, useEffect, useRef } from 'react';
import { UserAgent, Registerer, Inviter, Invitation, SessionState } from 'sip.js';
import { T } from '../theme';
import { Icon } from './Icons';

const WS_SERVER = 'wss://173.249.4.136/ws';
const SIP_DOMAIN = '173.249.4.136';
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

function attachAudio(session, audioEl) {
  try {
    const pc = session.sessionDescriptionHandler?.peerConnection;
    if (!pc || !audioEl) return;
    const stream = new MediaStream();
    pc.getReceivers().forEach(r => { if (r.track) stream.addTrack(r.track); });
    audioEl.srcObject = stream;
    audioEl.play().catch(() => {});
  } catch (e) {
    console.error('attachAudio:', e);
  }
}

export default function Softphone({ extension, sipPassword, onRegistered, onCallEnded }) {
  const [status, setStatus]   = useState('Connecting…');
  const [registered, setReg]  = useState(false);
  const [callStatus, setCallSt] = useState('');
  const [inCall, setInCall]   = useState(false);
  const [dial, setDial]       = useState('');
  const uaRef    = useRef(null);
  const sessRef  = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!extension || !sipPassword) return;
    const uri = UserAgent.makeURI(`sip:${extension}@${SIP_DOMAIN}`);
    const ua = new UserAgent({
      uri,
      transportOptions: { server: WS_SERVER, traceSip: false },
      authorizationUsername: extension,
      authorizationPassword: sipPassword,
      logBuiltinEnabled: false,
      sessionDescriptionHandlerFactoryOptions: { peerConnectionConfiguration: ICE },
    });

    ua.delegate = {
      onInvite: (inv) => {
        try {
          const caller = inv.remoteIdentity?.uri?.user ?? 'Unknown';
          setCallSt(`Incoming: ${caller}`);
          sessRef.current = inv;
          // Send 180 Ringing so the caller sees the ring state
          inv.progress().catch(e => console.warn('SIP 180 failed:', e));
          let established = false;
          inv.stateChange.addListener(st => {
            if (st === SessionState.Established) {
              established = true;
              setInCall(true);
              attachAudio(inv, audioRef.current);
            }
            if (st === SessionState.Terminated) {
              setInCall(false); setCallSt(''); sessRef.current = null;
              if (established) onCallEnded?.();
            }
          });
        } catch (e) {
          console.error('onInvite error:', e);
        }
      },
    };

    ua.start()
      .then(() => {
        const r = new Registerer(ua);
        r.register()
          .then(() => { setReg(true); setStatus('Registered'); onRegistered?.(true); })
          .catch(() => { setStatus('Registration failed'); onRegistered?.(false); });
      })
      .catch(() => setStatus('Connection failed'));

    uaRef.current = ua;
    return () => { ua.stop(); onRegistered?.(false); };
  }, [extension, sipPassword]);

  const call = () => {
    if (!dial || !uaRef.current || sessRef.current) return;
    const inv = new Inviter(uaRef.current, UserAgent.makeURI(`sip:${dial}@${SIP_DOMAIN}`), {
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
        peerConnectionConfiguration: ICE,
      },
    });
    let established = false;
    inv.stateChange.addListener(st => {
      if (st === SessionState.Established) {
        established = true;
        setInCall(true); setCallSt(`In call: ${dial}`);
        attachAudio(inv, audioRef.current);
      }
      if (st === SessionState.Terminated) {
        setInCall(false); setCallSt(''); sessRef.current = null;
        if (established) onCallEnded?.();
      }
    });
    sessRef.current = inv;
    setCallSt(`Calling ${dial}…`);
    inv.invite().catch(err => {
      console.error('INVITE failed:', err);
      setCallSt('Call failed — check microphone permission');
      sessRef.current = null;
      setTimeout(() => setCallSt(''), 4000);
    });
  };

  const answer = () => {
    const s = sessRef.current;
    if (!s) return;
    try {
      s.accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
          peerConnectionConfiguration: ICE,
        },
      }).catch(err => {
        console.error('accept failed:', err);
        setCallSt('Answer failed — check microphone permission');
        setTimeout(() => setCallSt(''), 4000);
      });
    } catch (e) {
      console.error('accept sync error:', e);
    }
  };

  const hangup = () => {
    const s = sessRef.current;
    if (!s) return;
    if (s.state === SessionState.Established) {
      s.bye().catch(() => {});
    } else if (s instanceof Inviter) {
      s.cancel().catch(() => {});
    } else if (s instanceof Invitation) {
      s.reject().catch(() => {});
    }
    setInCall(false); setCallSt(''); sessRef.current = null;
  };

  const incoming = callStatus.startsWith('Incoming');

  return (
    <div style={s.wrap}>
      <audio ref={audioRef} autoPlay />
      <div style={s.statusRow}>
        <div style={{ ...s.dot, background: registered ? T.success : T.error }} />
        <span style={s.statusText}>{status}</span>
      </div>

      {callStatus && <div style={s.callBanner}>{callStatus}</div>}

      {!inCall && !callStatus && (
        <div style={s.dialRow}>
          <input style={s.dialInput} placeholder="Dial extension…" value={dial}
            onChange={e => setDial(e.target.value)} onKeyDown={e => e.key === 'Enter' && call()} />
          <button style={s.callBtn} onClick={call} disabled={!registered}>
            <Icon name="phone" size={16} color="#fff" />
          </button>
        </div>
      )}

      {incoming && !inCall && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={s.answerBtn} onClick={answer}><Icon name="phone" size={15} color="#fff" /> Answer</button>
          <button style={s.rejectBtn} onClick={hangup}><Icon name="xMark" size={15} color="#fff" /> Reject</button>
        </div>
      )}

      {inCall && (
        <button style={s.hangupBtn} onClick={hangup}>
          <Icon name="xMark" size={15} color="#fff" /> Hang Up
        </button>
      )}
    </div>
  );
}

const s = {
  wrap:       { padding: '12px 14px', background: T.sidebar },
  statusRow:  { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  dot:        { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  statusText: { fontSize: 12, color: T.textSub },
  callBanner: { background: T.surface, border: '1px solid ' + T.border, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: T.text, marginBottom: 10, textAlign: 'center' },
  dialRow:    { display: 'flex', gap: 8 },
  dialInput:  { flex: 1, padding: '8px 10px', borderRadius: 7, border: '1px solid ' + T.border, background: T.surface, color: T.text, fontSize: 13 },
  callBtn:    { width: 36, height: 36, borderRadius: 7, background: T.success, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  answerBtn:  { flex: 1, padding: '8px 0', background: T.success, border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  rejectBtn:  { flex: 1, padding: '8px 0', background: T.error, border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  hangupBtn:  { width: '100%', padding: '9px 0', background: T.error, border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
};
