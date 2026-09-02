export default function ErrorMessage({ message }) {
  if (!message) return null;
  return (
    <p className="state-message error" role="alert">
      {message}
    </p>
  );
}
