from flask import Flask, render_template, request, Response
from picamera2 import Picamera2
import pigpio
import time
import cv2

PAN_PIN = 12
TILT_PIN = 13

LEFT_PWM = 18
LEFT_IN1 = 23
LEFT_IN2 = 24

RIGHT_PWM = 19
RIGHT_IN1 = 22
RIGHT_IN2 = 27

class Global_Vars:
    pan_angle = 90
    tilt_angle = 90

app = Flask(__name__)

@app.before_first_request
def init_camera():
    cam = Picamera2()
    config = cam.create_preview_configuration(main={"size": (640, 480), "format": "RGB888"})
    cam.configure(config)
    cam.set_controls({"AwbEnable": True, "AeEnable": True})

    app.config["camera"] = cam
    cam.start()
    time.sleep(1)

class MotorController:
    def __init__(self, pi):
        self.pi = pi

        self.motor_pins = [
            LEFT_IN1, LEFT_IN2,
            RIGHT_IN1, RIGHT_IN2
        ]

        self.pwm_pins = [
            LEFT_PWM,
            RIGHT_PWM
        ]

        for pin in self.motor_pins + self.pwm_pins:
            pi.set_mode(pin, pigpio.OUTPUT)
            pi.write(pin, 0)

    def set_motor(self, left_speed=0, right_speed=0, direction="stop"):

        if direction == "forward":
            l1, l2 = 1, 0
            r1, r2 = 1, 0
        elif direction == "backward":
            l1, l2 = 0, 1
            r1, r2 = 0, 1
        else:
            l1 = l2 = r1 = r2 = 0

        self.pi.write(LEFT_IN1, l1)
        self.pi.write(LEFT_IN2, l2)
        self.pi.write(RIGHT_IN1, r1)
        self.pi.write(RIGHT_IN2, r2)

        self.pi.set_PWM_dutycycle(LEFT_PWM, left_speed)
        self.pi.set_PWM_dutycycle(RIGHT_PWM, right_speed)

    def stop(self):
        self.set_motor(0, 0, "stop")

def angle_to_duty(angle):
    angle = max(0, min(180, angle))
    pulse = 500 + (angle / 180.0) * 2000
    return int((pulse / 20000.0) * 1000000)


def get_frames():
    cam = app.config["camera"]

    while True:
        frame = cam.capture_array()
        frame = cv2.flip(frame, -1)
        _, buffer = cv2.imencode('.jpg', frame)

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')

@app.route('/')
def index():
    return render_template("index.html")


@app.route('/video')
def video():
    return Response(get_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/keypress', methods=['POST'])
def keypress():
    data = request.get_json()
    key = data.get('key')

    if key == 'w':
        motor_controller.set_motor(255, 255, "forward")

    elif key == 's':
        motor_controller.set_motor(255, 255, "backward")

    elif key == 'a':
        motor_controller.set_motor(0, 255, "forward")

    elif key == 'd':
        motor_controller.set_motor(255, 0, "forward")

    elif key == 'stop':
        motor_controller.stop()

    elif key == 'ArrowLeft':
        Global_Vars.pan_angle = max(0, Global_Vars.pan_angle - 2)
        pi.hardware_PWM(PAN_PIN, 50, angle_to_duty(Global_Vars.pan_angle))

    elif key == 'ArrowRight':
        Global_Vars.pan_angle = min(180, Global_Vars.pan_angle + 2)
        pi.hardware_PWM(PAN_PIN, 50, angle_to_duty(Global_Vars.pan_angle))

    elif key == 'ArrowUp':
        Global_Vars.tilt_angle = max(0, Global_Vars.tilt_angle - 2)
        pi.hardware_PWM(TILT_PIN, 50, angle_to_duty(Global_Vars.tilt_angle))

    elif key == 'ArrowDown':
        Global_Vars.tilt_angle = min(180, Global_Vars.tilt_angle + 2)
        pi.hardware_PWM(TILT_PIN, 50, angle_to_duty(Global_Vars.tilt_angle))

    return '', 204


if __name__ == '__main__':
    pi = pigpio.pi()

    if not pi.connected:
        raise Exception("pigpio daemon not running")

    motor_controller = MotorController(pi)

    pi.hardware_PWM(PAN_PIN, 50, angle_to_duty(Global_Vars.pan_angle))
    pi.hardware_PWM(TILT_PIN, 50, angle_to_duty(Global_Vars.tilt_angle))

    try:
        app.run(host='0.0.0.0', debug=False)
    finally:
        motor_controller.stop()
        pi.hardware_PWM(PAN_PIN, 0, 0)
        pi.hardware_PWM(TILT_PIN, 0, 0)
        pi.stop()