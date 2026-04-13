class Gym:

    def __init__(self):
        self.workouts = []

    def add_workout(self, name):
        self.workouts.append(name)

    def show_workouts(self):
        for workout in self.workouts:
            print(workout)