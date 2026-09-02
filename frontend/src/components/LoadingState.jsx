export default function LoadingState({ label = "Loading..." }) {
  return (
    <p className="state-message" role="status">
      {label}
    </p>
  );
}
