import unittest

from fastapi import HTTPException

from main import GenerationRequest, build_and_solve, calculate_student_metrics


def request_for_enrollment(students: int, room_capacity: int = 100) -> GenerationRequest:
    return GenerationRequest(
        courses=[{
            "courseCode": "CS101",
            "sessionsPerWeek": 1,
            "durationHours": 1,
            "facultyName": "Faculty A",
            "batch": "CSE A",
            "students": students,
            "roomType": "classroom",
            "availableDays": ["monday"],
            "availableFromHour": 10,
            "availableUntilHour": 11,
        }],
        rooms=[{"name": "CR 1", "type": "classroom", "capacity": room_capacity}],
        workingDays=["monday"],
        startHour=9,
        endHour=11,
        semester="Semester 3",
    )


class StudentObjectiveTests(unittest.TestCase):
    def test_student_time_cost_scales_with_enrollment(self):
        small = build_and_solve(request_for_enrollment(25), "student-experience", [])
        large = build_and_solve(request_for_enrollment(75), "student-experience", [])

        self.assertEqual(small["status"], "OPTIMAL")
        self.assertEqual(large["status"], "OPTIMAL")
        self.assertEqual(small["assignments"][0]["startTime"], "10:00")
        self.assertEqual(large["assignments"][0]["startTime"], "10:00")
        self.assertEqual(large["objectiveValue"], small["objectiveValue"] * 3)

    def test_idle_gap_metric_weights_batch_size(self):
        metrics = calculate_student_metrics([
            {"batch": "CSE A", "dayOfWeek": "monday", "startTime": "09:00", "endTime": "10:00", "students": 100},
            {"batch": "CSE A", "dayOfWeek": "monday", "startTime": "12:00", "endTime": "13:00", "students": 35},
        ])

        self.assertEqual(metrics["estimatedStudentGapMinutes"], 12000)
        self.assertEqual(metrics["estimatedStudentDaysOnCampus"], 100)

    def test_room_capacity_remains_a_hard_constraint(self):
        with self.assertRaises(HTTPException) as raised:
            build_and_solve(request_for_enrollment(75, room_capacity=50), "student-experience", [])

        self.assertEqual(raised.exception.status_code, 422)

    def test_lab_is_not_rejected_for_cohort_size(self):
        request = GenerationRequest(
            courses=[{
                "courseCode": "CS201-LAB",
                "sessionsPerWeek": 1,
                "durationHours": 2,
                "facultyName": "Faculty B",
                "batch": "CSE A",
                "students": 200,
                "roomType": "lab",
                "availableDays": ["monday"],
            }],
            rooms=[{"name": "CSE Lab 1", "type": "lab"}],
            workingDays=["monday"],
            startHour=9,
            endHour=12,
            semester="Semester 3",
        )
        for profile in ("student-experience", "room-utilization", "faculty-balance"):
            with self.subTest(profile=profile):
                result = build_and_solve(request, profile, [])
                self.assertEqual(result["status"], "OPTIMAL")
                self.assertEqual(result["assignments"][0]["roomNo"], "CSE Lab 1")

    def test_multiple_batches_are_solved_together(self):
        request = GenerationRequest(
            courses=[
                {
                    "courseCode": "CS301",
                    "sessionsPerWeek": 1,
                    "durationHours": 1,
                    "facultyName": "Shared Faculty",
                    "batch": batch,
                    "students": 30,
                    "roomType": "classroom",
                    "availableDays": ["monday"],
                }
                for batch in ("CSE A", "CSE B")
            ],
            rooms=[{"name": "CR 1", "type": "classroom", "capacity": 60}],
            workingDays=["monday"],
            startHour=9,
            endHour=11,
            semester="Semester 3",
        )

        result = build_and_solve(request, "student-experience", [])
        self.assertEqual(result["status"], "OPTIMAL")
        self.assertEqual({item["batch"] for item in result["assignments"]}, {"CSE A", "CSE B"})
        self.assertNotEqual(result["assignments"][0]["startTime"], result["assignments"][1]["startTime"])


if __name__ == "__main__":
    unittest.main()