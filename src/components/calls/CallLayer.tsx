import { IncomingCallModal } from "@/components/calls/IncomingCallModal";
import { CallScreen } from "@/components/calls/CallScreen";
import { VideoCallScreen } from "@/components/calls/VideoCallScreen";
import { useCallManager } from "@/contexts/CallContext";

export function CallLayer() {
  const {
    activeCall,
    incomingCallVisible,
    phase,
    connectionState,
    localStream,
    remoteStream,
    isMuted,
    isCameraEnabled,
    errorMessage,
    acceptIncomingCall,
    declineIncomingCall,
    hangupActiveCall,
    toggleMute,
    toggleCamera,
  } = useCallManager();

  if (!activeCall) return null;

  const showIncomingPrompt =
    incomingCallVisible && activeCall.role === "callee" && activeCall.session.status === "ringing";
  const showInCallScreen = activeCall.session.status === "accepted" || activeCall.role === "caller";

  return (
    <>
      <IncomingCallModal
        open={showIncomingPrompt}
        callerName={activeCall.peerDisplayName}
        type={activeCall.session.type}
        onAccept={() => {
          void acceptIncomingCall();
        }}
        onDecline={() => {
          void declineIncomingCall();
        }}
      />

      {showInCallScreen &&
        (activeCall.session.type === "video" ? (
          <VideoCallScreen
            activeCall={activeCall}
            phase={phase}
            connectionState={connectionState}
            localStream={localStream}
            remoteStream={remoteStream}
            isMuted={isMuted}
            isCameraEnabled={isCameraEnabled}
            errorMessage={errorMessage}
            onToggleMute={toggleMute}
            onToggleCamera={toggleCamera}
            onHangup={() => {
              void hangupActiveCall();
            }}
          />
        ) : (
          <CallScreen
            activeCall={activeCall}
            phase={phase}
            connectionState={connectionState}
            remoteStream={remoteStream}
            isMuted={isMuted}
            errorMessage={errorMessage}
            onToggleMute={toggleMute}
            onHangup={() => {
              void hangupActiveCall();
            }}
          />
        ))}
    </>
  );
}
