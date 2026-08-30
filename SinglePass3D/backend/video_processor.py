import cv2
import os
import sys


# -----------------------------
# Configuration
# -----------------------------

FPS_TO_SAMPLE = 2
BLUR_THRESHOLD = 80.0


# -----------------------------
# Blur detection
# -----------------------------

def calculate_blur_score(frame):
    """
    Higher score = sharper image.
    Lower score = more blurry image.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    return cv2.Laplacian(gray, cv2.CV_64F).var()


# -----------------------------
# Frame extraction
# -----------------------------

def process_video(video_path, output_folder):
    if not os.path.exists(video_path):
        print(f"ERROR: Video not found: {video_path}")
        return

    os.makedirs(output_folder, exist_ok=True)

    video = cv2.VideoCapture(video_path)

    if not video.isOpened():
        print("ERROR: Could not open video.")
        return

    original_fps = video.get(cv2.CAP_PROP_FPS)
    total_frames = int(video.get(cv2.CAP_PROP_FRAME_COUNT))

    if original_fps <= 0:
        print("ERROR: Could not determine video FPS.")
        video.release()
        return

    duration = total_frames / original_fps

    print("\n========== SINGLE-PASS 3D ==========")
    print("Video:", video_path)
    print(f"Original FPS: {original_fps:.2f}")
    print(f"Total frames: {total_frames}")
    print(f"Duration: {duration:.2f} seconds")
    print(f"Sampling: {FPS_TO_SAMPLE} frames/second")
    print(f"Blur threshold: {BLUR_THRESHOLD}")
    print("====================================\n")

    frame_interval = max(1, int(original_fps / FPS_TO_SAMPLE))

    frame_number = 0
    saved_count = 0
    rejected_count = 0

    while True:

        success, frame = video.read()

        if not success:
            break

        if frame_number % frame_interval == 0:

            blur_score = calculate_blur_score(frame)

            if blur_score >= BLUR_THRESHOLD:

                filename = f"frame_{saved_count:05d}.jpg"

                output_path = os.path.join(
                    output_folder,
                    filename
                )

                cv2.imwrite(output_path, frame)

                saved_count += 1

                print(
                    f"[KEEP] {frame_number:05d} "
                    f"| Blur score: {blur_score:.2f}"
                )

            else:

                rejected_count += 1

                print(
                    f"[REJECT] {frame_number:05d} "
                    f"| Blur score: {blur_score:.2f}"
                )

        frame_number += 1

    video.release()

    print("\n========== PROCESSING COMPLETE ==========")
    print(f"Frames checked: {frame_number}")
    print(f"Frames saved: {saved_count}")
    print(f"Frames rejected: {rejected_count}")
    print(f"Output folder: {output_folder}")
    print("=========================================\n")


# -----------------------------
# Main
# -----------------------------

if __name__ == "__main__":

    if len(sys.argv) < 2:

        print(
            "\nUsage:\n"
            "python backend/video_processor.py <video_path>\n"
        )

        sys.exit(1)

    video_path = sys.argv[1]

    output_folder = os.path.join(
        "output",
        "selected_frames"
    )

    process_video(
        video_path,
        output_folder
    )